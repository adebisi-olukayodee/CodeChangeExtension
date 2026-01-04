"use strict";
/**
 * API Rules Engine - converts API diffs into breaking change findings
 * Integrates with the existing breaking change rule system.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiDiffToFindings = void 0;
const EnhancedImpactReport_js_1 = require("../../types/EnhancedImpactReport.js");
/**
 * Converts an API diff into breaking change findings with rule IDs.
 */
function apiDiffToFindings(apiDiff, entrypointPath) {
    const findings = [];
    // Process removed exports (always breaking)
    for (const removed of apiDiff.removed) {
        const ruleId = getRemovedExportRuleId(removed.shape);
        findings.push({
            ruleId,
            severity: 'breaking',
            symbol: removed.shape.name,
            file: entrypointPath,
            message: `Export removed: ${removed.shape.name}`,
            kind: removed.shape.kind,
            isExported: true
        });
    }
    // Process modified exports (breaking changes)
    for (const modified of apiDiff.modified) {
        const ruleFindings = getModifiedExportFindings(modified.before, modified.after, entrypointPath);
        findings.push(...ruleFindings);
    }
    // Process renamed exports (info - may indicate refactoring)
    for (const renamed of apiDiff.renamed) {
        findings.push({
            ruleId: undefined,
            severity: 'info',
            symbol: renamed.name,
            file: entrypointPath,
            message: `Export renamed/moved: ${renamed.name} (identity changed)`,
            kind: 'rename',
            isExported: true
        });
    }
    // Added exports are non-breaking (info level)
    for (const added of apiDiff.added) {
        findings.push({
            ruleId: undefined,
            severity: 'info',
            symbol: added.shape.name,
            file: entrypointPath,
            message: `Export added: ${added.shape.name}`,
            kind: added.shape.kind,
            isExported: true
        });
    }
    return findings;
}
exports.apiDiffToFindings = apiDiffToFindings;
/**
 * Gets the appropriate rule ID for a removed export based on its kind.
 */
function getRemovedExportRuleId(shape) {
    switch (shape.kind) {
        case 'function':
            return EnhancedImpactReport_js_1.BreakingChangeRule.FN_REMOVED;
        case 'class':
            return EnhancedImpactReport_js_1.BreakingChangeRule.CLS_REMOVED;
        case 'interface':
            return EnhancedImpactReport_js_1.BreakingChangeRule.IFACE_REMOVED;
        case 'type':
            return EnhancedImpactReport_js_1.BreakingChangeRule.TYPE_REMOVED;
        case 'enum':
            return EnhancedImpactReport_js_1.BreakingChangeRule.ENUM_REMOVED;
        case 'variable':
        case 'const':
            return EnhancedImpactReport_js_1.BreakingChangeRule.EXPORT_REMOVED;
        default:
            return EnhancedImpactReport_js_1.BreakingChangeRule.EXPORT_REMOVED;
    }
}
/**
 * Gets breaking change findings for a modified export.
 */
function getModifiedExportFindings(before, after, entrypointPath) {
    const findings = [];
    if (before.kind !== after.kind) {
        findings.push({
            ruleId: EnhancedImpactReport_js_1.BreakingChangeRule.EXPORT_TYPE_CHANGED,
            severity: 'breaking',
            symbol: before.name,
            file: entrypointPath,
            message: `Export kind changed from ${before.kind} to ${after.kind}`,
            kind: after.kind,
            isExported: true
        });
        return findings;
    }
    switch (before.kind) {
        case 'function':
            if (after.kind === 'function') {
                findings.push(...getFunctionChangeFindings(before, after, entrypointPath));
            }
            break;
        case 'class':
            if (after.kind === 'class') {
                findings.push(...getClassChangeFindings(before, after, entrypointPath));
            }
            break;
        case 'type':
        case 'interface':
            if (after.kind === before.kind) {
                findings.push(...getTypeChangeFindings(before, after, entrypointPath));
            }
            break;
        case 'enum':
            if (after.kind === 'enum') {
                findings.push(...getEnumChangeFindings(before, after, entrypointPath));
            }
            break;
    }
    return findings;
}
/**
 * Gets breaking change findings for function modifications.
 */
function getFunctionChangeFindings(before, after, entrypointPath) {
    const findings = [];
    // Check for overload changes
    if (before.overloads.length !== after.overloads.length) {
        findings.push({
            ruleId: EnhancedImpactReport_js_1.BreakingChangeRule.FN_OVERLOAD_CHANGED,
            severity: 'breaking',
            symbol: before.name,
            file: entrypointPath,
            message: `Function overload count changed from ${before.overloads.length} to ${after.overloads.length}`,
            kind: 'function',
            isExported: true
        });
    }
    // Compare each overload
    const maxOverloads = Math.max(before.overloads.length, after.overloads.length);
    for (let i = 0; i < maxOverloads; i++) {
        const beforeOverload = before.overloads[i];
        const afterOverload = after.overloads[i];
        if (!beforeOverload || !afterOverload) {
            continue; // Already handled above
        }
        // Check return type
        if (beforeOverload.returnType !== afterOverload.returnType) {
            findings.push({
                ruleId: EnhancedImpactReport_js_1.BreakingChangeRule.FN_RETURN_TYPE_CHANGED,
                severity: 'breaking',
                symbol: before.name,
                file: entrypointPath,
                message: `Function return type changed: ${beforeOverload.returnType} -> ${afterOverload.returnType}`,
                kind: 'function',
                isExported: true
            });
        }
        // Check parameters
        const beforeParams = new Map(beforeOverload.parameters.map((p, idx) => [p.name || `param${idx}`, p]));
        const afterParams = new Map(afterOverload.parameters.map((p, idx) => [p.name || `param${idx}`, p]));
        // Check for removed parameters
        for (const [name, beforeParam] of beforeParams) {
            if (!afterParams.has(name)) {
                findings.push({
                    ruleId: EnhancedImpactReport_js_1.BreakingChangeRule.FN_PARAM_REMOVED,
                    severity: 'breaking',
                    symbol: before.name,
                    file: entrypointPath,
                    message: `Function parameter removed: ${name}`,
                    kind: 'function',
                    isExported: true
                });
            }
            else {
                const afterParam = afterParams.get(name);
                // Check for type changes
                if (beforeParam.type !== afterParam.type) {
                    findings.push({
                        ruleId: EnhancedImpactReport_js_1.BreakingChangeRule.FN_PARAM_TYPE_CHANGED,
                        severity: 'breaking',
                        symbol: before.name,
                        file: entrypointPath,
                        message: `Function parameter type changed: ${name}: ${beforeParam.type} -> ${afterParam.type}`,
                        kind: 'function',
                        isExported: true
                    });
                }
                // Check for optional -> required
                if (beforeParam.optional && !afterParam.optional) {
                    findings.push({
                        ruleId: EnhancedImpactReport_js_1.BreakingChangeRule.FN_PARAM_REQUIRED,
                        severity: 'breaking',
                        symbol: before.name,
                        file: entrypointPath,
                        message: `Function parameter changed from optional to required: ${name}`,
                        kind: 'function',
                        isExported: true
                    });
                }
            }
        }
    }
    return findings;
}
/**
 * Gets breaking change findings for class modifications.
 */
function getClassChangeFindings(before, after, entrypointPath) {
    const findings = [];
    const beforeMembers = new Map(before.members.map(m => [m.name, m]));
    const afterMembers = new Map(after.members.map(m => [m.name, m]));
    // Check for removed members
    for (const [name, beforeMember] of beforeMembers) {
        if (!afterMembers.has(name)) {
            const ruleId = beforeMember.kind === 'method'
                ? EnhancedImpactReport_js_1.BreakingChangeRule.CLS_METHOD_REMOVED
                : EnhancedImpactReport_js_1.BreakingChangeRule.CLS_PROPERTY_REMOVED;
            findings.push({
                ruleId,
                severity: 'breaking',
                symbol: before.name,
                file: entrypointPath,
                message: `Class ${beforeMember.kind} removed: ${name}`,
                kind: 'class',
                isExported: true
            });
        }
        else {
            const afterMember = afterMembers.get(name);
            // Check for signature changes in methods
            if (beforeMember.kind === 'method' && afterMember.kind === 'method') {
                if (beforeMember.signature && afterMember.signature) {
                    // Compare signatures (simplified - could be more detailed)
                    const beforeSig = JSON.stringify(beforeMember.signature);
                    const afterSig = JSON.stringify(afterMember.signature);
                    if (beforeSig !== afterSig) {
                        findings.push({
                            ruleId: EnhancedImpactReport_js_1.BreakingChangeRule.CLS_METHOD_SIGNATURE_CHANGED,
                            severity: 'breaking',
                            symbol: before.name,
                            file: entrypointPath,
                            message: `Class method signature changed: ${name}`,
                            kind: 'class',
                            isExported: true
                        });
                    }
                }
            }
        }
    }
    return findings;
}
/**
 * Gets breaking change findings for type/interface modifications.
 */
function getTypeChangeFindings(before, after, entrypointPath) {
    const findings = [];
    const beforeProps = new Map(before.properties.map(p => [p.name, p]));
    const afterProps = new Map(after.properties.map(p => [p.name, p]));
    // Check for removed properties
    for (const [name, beforeProp] of beforeProps) {
        if (!afterProps.has(name)) {
            const ruleId = before.kind === 'interface'
                ? EnhancedImpactReport_js_1.BreakingChangeRule.IFACE_PROPERTY_REMOVED
                : EnhancedImpactReport_js_1.BreakingChangeRule.TYPE_PROPERTY_TYPE_CHANGED; // Use as fallback
            findings.push({
                ruleId,
                severity: 'breaking',
                symbol: before.name,
                file: entrypointPath,
                message: `${before.kind} property removed: ${name}`,
                kind: before.kind,
                isExported: true
            });
        }
        else {
            const afterProp = afterProps.get(name);
            // Check for optional -> required
            if (beforeProp.optional && !afterProp.optional) {
                const ruleId = before.kind === 'interface'
                    ? EnhancedImpactReport_js_1.BreakingChangeRule.IFACE_PROPERTY_REQUIRED
                    : EnhancedImpactReport_js_1.BreakingChangeRule.TYPE_PROPERTY_REQUIRED;
                findings.push({
                    ruleId,
                    severity: 'breaking',
                    symbol: before.name,
                    file: entrypointPath,
                    message: `${before.kind} property changed from optional to required: ${name}`,
                    kind: before.kind,
                    isExported: true
                });
            }
            // Check for type changes
            if (beforeProp.type !== afterProp.type) {
                const ruleId = before.kind === 'interface'
                    ? EnhancedImpactReport_js_1.BreakingChangeRule.IFACE_PROPERTY_TYPE_CHANGED
                    : EnhancedImpactReport_js_1.BreakingChangeRule.TYPE_PROPERTY_TYPE_CHANGED;
                findings.push({
                    ruleId,
                    severity: 'breaking',
                    symbol: before.name,
                    file: entrypointPath,
                    message: `${before.kind} property type changed: ${name}: ${beforeProp.type} -> ${afterProp.type}`,
                    kind: before.kind,
                    isExported: true
                });
            }
        }
    }
    // Check for type text changes (for complex types)
    if (before.typeText && after.typeText && before.typeText !== after.typeText) {
        findings.push({
            ruleId: EnhancedImpactReport_js_1.BreakingChangeRule.TYPE_DEFINITION_CHANGED,
            severity: 'breaking',
            symbol: before.name,
            file: entrypointPath,
            message: `${before.kind} definition changed`,
            kind: before.kind,
            isExported: true
        });
    }
    return findings;
}
/**
 * Gets breaking change findings for enum modifications.
 */
function getEnumChangeFindings(before, after, entrypointPath) {
    const findings = [];
    const beforeMembers = new Map(before.members.map(m => [m.name, m]));
    const afterMembers = new Map(after.members.map(m => [m.name, m]));
    // Check for removed members
    for (const [name, beforeMember] of beforeMembers) {
        if (!afterMembers.has(name)) {
            findings.push({
                ruleId: EnhancedImpactReport_js_1.BreakingChangeRule.ENUM_MEMBER_REMOVED,
                severity: 'breaking',
                symbol: before.name,
                file: entrypointPath,
                message: `Enum member removed: ${name}`,
                kind: 'enum',
                isExported: true
            });
        }
    }
    return findings;
}
//# sourceMappingURL=ApiRulesEngine.js.map