/**
 * API Diff - compares API snapshots to detect breaking changes
 */

import { 
    ApiSnapshot, 
    ApiShape, 
    ExportIdentity, 
    ApiDiff,
    FunctionApiShape,
    ClassApiShape,
    TypeApiShape,
    EnumApiShape,
    VariableApiShape,
    FunctionSignature,
    ClassMember
} from './ApiSnapshotTypes.js';
import * as ts from 'typescript';

/**
 * Computes the diff between two API snapshots.
 */
export function computeApiDiff(before: ApiSnapshot, after: ApiSnapshot): ApiDiff {
    const removed: Array<{ identity: ExportIdentity; shape: ApiShape }> = [];
    const added: Array<{ identity: ExportIdentity; shape: ApiShape }> = [];
    const modified: Array<{
        identity: ExportIdentity;
        before: ApiShape;
        after: ApiShape;
        changes: string[];
    }> = [];
    const renamed: Array<{
        beforeIdentity: ExportIdentity;
        afterIdentity: ExportIdentity;
        name: string;
    }> = [];

    // Build maps for efficient lookup
    const beforeExports = new Map<ExportIdentity, ApiShape>();
    const afterExports = new Map<ExportIdentity, ApiShape>();
    
    // Also build name-based maps for fallback matching
    const beforeByName = new Map<string, Array<{ identity: ExportIdentity; shape: ApiShape }>>();
    const afterByName = new Map<string, Array<{ identity: ExportIdentity; shape: ApiShape }>>();

    for (const [identity, shape] of before.exports) {
        beforeExports.set(identity, shape);
        
        const name = shape.name;
        if (!beforeByName.has(name)) {
            beforeByName.set(name, []);
        }
        beforeByName.get(name)!.push({ identity, shape });
    }

    for (const [identity, shape] of after.exports) {
        afterExports.set(identity, shape);
        
        const name = shape.name;
        if (!afterByName.has(name)) {
            afterByName.set(name, []);
        }
        afterByName.get(name)!.push({ identity, shape });
    }

    // Find removed exports (present in before but not after)
    for (const [identity, shape] of before.exports) {
        if (!afterExports.has(identity)) {
            // Try fallback matching by name/kind
            const name = shape.name;
            const afterCandidates = afterByName.get(name) || [];
            const matching = afterCandidates.find(c => 
                c.shape.kind === shape.kind && 
                shapesAreSimilar(shape, c.shape)
            );
            
            if (matching) {
                // Likely a rename/move - track as renamed
                renamed.push({
                    beforeIdentity: identity,
                    afterIdentity: matching.identity,
                    name
                });
            } else {
                // Truly removed
                removed.push({ identity, shape });
            }
        }
    }

    // Find added exports (present in after but not before)
    for (const [identity, shape] of after.exports) {
        if (!beforeExports.has(identity)) {
            // Check if it's a rename (already handled above)
            const isRenamed = renamed.some(r => r.afterIdentity === identity);
            if (!isRenamed) {
                added.push({ identity, shape });
            }
        }
    }

    // Find modified exports (same identity but shape changed)
    for (const [identity, shape] of before.exports) {
        const afterShape = afterExports.get(identity);
        if (afterShape && !shapesAreEqual(shape, afterShape)) {
            const changes = computeShapeChanges(shape, afterShape);
            modified.push({
                identity,
                before: shape,
                after: afterShape,
                changes
            });
        }
    }

    return {
        removed,
        added,
        modified,
        renamed
    };
}

/**
 * Checks if two shapes are equal (deep comparison).
 */
function shapesAreEqual(shape1: ApiShape, shape2: ApiShape): boolean {
    if (shape1.kind !== shape2.kind || shape1.name !== shape2.name) {
        return false;
    }

    switch (shape1.kind) {
        case 'function':
            if (shape2.kind !== 'function') return false;
            return functionShapesEqual(shape1, shape2);
        case 'class':
            if (shape2.kind !== 'class') return false;
            return classShapesEqual(shape1, shape2);
        case 'type':
        case 'interface':
            if (shape2.kind !== shape1.kind) return false;
            return typeShapesEqual(shape1, shape2);
        case 'enum':
            if (shape2.kind !== 'enum') return false;
            return enumShapesEqual(shape1, shape2);
        case 'variable':
        case 'const':
            if (shape2.kind !== shape1.kind) return false;
            return variableShapesEqual(shape1, shape2);
        default:
            return false;
    }
}

/**
 * Checks if two shapes are similar (for rename detection).
 */
function shapesAreSimilar(shape1: ApiShape, shape2: ApiShape): boolean {
    if (shape1.kind !== shape2.kind) {
        return false;
    }
    
    // For similarity, we're more lenient - just check kind matches
    // The actual diff will show the differences
    return true;
}

function functionShapesEqual(f1: FunctionApiShape, f2: FunctionApiShape): boolean {
    if (f1.overloads.length !== f2.overloads.length) {
        return false;
    }
    
    for (let i = 0; i < f1.overloads.length; i++) {
        if (!signaturesEqual(f1.overloads[i], f2.overloads[i])) {
            return false;
        }
    }
    
    return true;
}

function signaturesEqual(s1: FunctionSignature, s2: FunctionSignature): boolean {
    if (s1.parameters.length !== s2.parameters.length) {
        return false;
    }
    
    if (s1.returnType !== s2.returnType) {
        return false;
    }
    
    for (let i = 0; i < s1.parameters.length; i++) {
        const p1 = s1.parameters[i];
        const p2 = s2.parameters[i];
        
        if (p1.name !== p2.name ||
            p1.type !== p2.type ||
            p1.optional !== p2.optional ||
            p1.rest !== p2.rest) {
            return false;
        }
    }
    
    return true;
}

function classShapesEqual(c1: ClassApiShape, c2: ClassApiShape): boolean {
    if (c1.members.length !== c2.members.length) {
        return false;
    }
    
            const members1 = new Map(c1.members.map((m: ClassMember) => [m.name, m]));
            const members2 = new Map(c2.members.map((m: ClassMember) => [m.name, m]));
    
    for (const [name, member1] of members1) {
        const member2 = members2.get(name);
        if (!member2 || !membersEqual(member1, member2)) {
            return false;
        }
    }
    
    return true;
}

function membersEqual(m1: ClassMember, m2: ClassMember): boolean {
    return m1.kind === m2.kind &&
           m1.name === m2.name &&
           m1.optional === m2.optional &&
           m1.readonly === m2.readonly &&
           m1.visibility === m2.visibility &&
           m1.static === m2.static &&
           m1.type === m2.type &&
           (m1.signature && m2.signature ? signaturesEqual(m1.signature, m2.signature) : !m1.signature && !m2.signature);
}

function typeShapesEqual(t1: TypeApiShape, t2: TypeApiShape): boolean {
    if (t1.properties.length !== t2.properties.length) {
        return false;
    }
    
    const props1 = new Map(t1.properties.map((p: { name: string; type: string; optional?: boolean; readonly?: boolean }) => [p.name, p]));
    const props2 = new Map(t2.properties.map((p: { name: string; type: string; optional?: boolean; readonly?: boolean }) => [p.name, p]));
    
    for (const [name, prop1] of props1) {
        const prop2 = props2.get(name);
        if (!prop2 ||
            (prop1 as any).type !== (prop2 as any).type ||
            (prop1 as any).optional !== (prop2 as any).optional ||
            (prop1 as any).readonly !== (prop2 as any).readonly) {
            return false;
        }
    }
    
    return true;
}

function enumShapesEqual(e1: EnumApiShape, e2: EnumApiShape): boolean {
    if (e1.members.length !== e2.members.length) {
        return false;
    }
    
    const members1 = new Map(e1.members.map((m: { name: string; value?: string | number }) => [m.name, m]));
    const members2 = new Map(e2.members.map((m: { name: string; value?: string | number }) => [m.name, m]));
    
    for (const [name, member1] of members1) {
        const member2 = members2.get(name);
        if (!member2 || (member1 as any).value !== (member2 as any).value) {
            return false;
        }
    }
    
    return true;
}

function variableShapesEqual(v1: VariableApiShape, v2: VariableApiShape): boolean {
    return v1.type === v2.type &&
           v1.readonly === v2.readonly;
}

/**
 * Computes a list of changes between two shapes.
 */
function computeShapeChanges(before: ApiShape, after: ApiShape): string[] {
    const changes: string[] = [];
    
    if (before.kind !== after.kind) {
        changes.push(`Kind changed from ${before.kind} to ${after.kind}`);
        return changes;
    }
    
    switch (before.kind) {
        case 'function':
            if (after.kind === 'function') {
                changes.push(...computeFunctionChanges(before, after));
            }
            break;
        case 'class':
            if (after.kind === 'class') {
                changes.push(...computeClassChanges(before, after));
            }
            break;
        case 'type':
        case 'interface':
            if (after.kind === before.kind) {
                changes.push(...computeTypeChanges(before, after));
            }
            break;
        case 'enum':
            if (after.kind === 'enum') {
                changes.push(...computeEnumChanges(before, after));
            }
            break;
        case 'variable':
        case 'const':
            if (after.kind === before.kind) {
                changes.push(...computeVariableChanges(before, after));
            }
            break;
    }
    
    return changes;
}

function computeFunctionChanges(before: FunctionApiShape, after: FunctionApiShape): string[] {
    const changes: string[] = [];
    
    if (before.overloads.length !== after.overloads.length) {
        changes.push(`Number of overloads changed from ${before.overloads.length} to ${after.overloads.length}`);
    }
    
    // Compare each overload
    const maxOverloads = Math.max(before.overloads.length, after.overloads.length);
    for (let i = 0; i < maxOverloads; i++) {
        const beforeOverload = before.overloads[i];
        const afterOverload = after.overloads[i];
        
        if (!beforeOverload) {
            changes.push(`Overload ${i + 1} added`);
        } else if (!afterOverload) {
            changes.push(`Overload ${i + 1} removed`);
        } else {
            if (beforeOverload.returnType !== afterOverload.returnType) {
                changes.push(`Overload ${i + 1} return type changed from ${beforeOverload.returnType} to ${afterOverload.returnType}`);
            }
            
            if (beforeOverload.parameters.length !== afterOverload.parameters.length) {
                changes.push(`Overload ${i + 1} parameter count changed from ${beforeOverload.parameters.length} to ${afterOverload.parameters.length}`);
            } else {
                for (let j = 0; j < beforeOverload.parameters.length; j++) {
                    const p1 = beforeOverload.parameters[j];
                    const p2 = afterOverload.parameters[j];
                    
                    if (p1.type !== p2.type) {
                        changes.push(`Overload ${i + 1} parameter ${p1.name} type changed from ${p1.type} to ${p2.type}`);
                    }
                    if (p1.optional !== p2.optional) {
                        changes.push(`Overload ${i + 1} parameter ${p1.name} optionality changed`);
                    }
                }
            }
        }
    }
    
    return changes;
}

function computeClassChanges(before: ClassApiShape, after: ClassApiShape): string[] {
    const changes: string[] = [];
    
    const membersBefore = new Map(before.members.map(m => [m.name, m]));
    const membersAfter = new Map(after.members.map(m => [m.name, m]));
    
    // Find removed members
    for (const [name, member] of membersBefore) {
        if (!membersAfter.has(name)) {
            changes.push(`Member ${name} removed`);
        }
    }
    
    // Find added/modified members
    for (const [name, member] of membersAfter) {
        const beforeMember = membersBefore.get(name);
        if (!beforeMember) {
            changes.push(`Member ${name} added`);
        } else if (!membersEqual(beforeMember, member)) {
            changes.push(`Member ${name} signature changed`);
        }
    }
    
    return changes;
}

function computeTypeChanges(before: TypeApiShape, after: TypeApiShape): string[] {
    const changes: string[] = [];
    
    const propsBefore = new Map(before.properties.map((p: { name: string; type: string; optional?: boolean }) => [p.name, p]));
    const propsAfter = new Map(after.properties.map((p: { name: string; type: string; optional?: boolean }) => [p.name, p]));
    
    // Find removed properties
    for (const [name, prop] of propsBefore) {
        if (!propsAfter.has(name)) {
            changes.push(`Property ${name} removed`);
        }
    }
    
    // Find added/modified properties
    for (const [name, prop] of propsAfter) {
        const beforeProp = propsBefore.get(name);
        if (!beforeProp) {
            changes.push(`Property ${name} added`);
        } else {
            if ((prop as any).type !== (beforeProp as any).type) {
                changes.push(`Property ${name} type changed from ${(beforeProp as any).type} to ${(prop as any).type}`);
            }
            if ((prop as any).optional !== (beforeProp as any).optional) {
                changes.push(`Property ${name} optionality changed`);
            }
        }
    }
    
    return changes;
}

function computeEnumChanges(before: EnumApiShape, after: EnumApiShape): string[] {
    const changes: string[] = [];
    
    const membersBefore = new Map(before.members.map((m: { name: string; value?: string | number }) => [m.name, m]));
    const membersAfter = new Map(after.members.map((m: { name: string; value?: string | number }) => [m.name, m]));
    
    // Find removed members
    for (const [name, member] of membersBefore) {
        if (!membersAfter.has(name)) {
            changes.push(`Enum member ${name} removed`);
        }
    }
    
    // Find added/modified members
    for (const [name, member] of membersAfter) {
        const beforeMember = membersBefore.get(name);
        if (!beforeMember) {
            changes.push(`Enum member ${name} added`);
        } else if ((member as any).value !== (beforeMember as any).value) {
            changes.push(`Enum member ${name} value changed`);
        }
    }
    
    return changes;
}

function computeVariableChanges(before: VariableApiShape, after: VariableApiShape): string[] {
    const changes: string[] = [];
    
    if (before.type !== after.type) {
        changes.push(`Type changed from ${before.type} to ${after.type}`);
    }
    if (before.readonly !== after.readonly) {
        changes.push(`Readonly changed from ${before.readonly} to ${after.readonly}`);
    }
    
    return changes;
}

