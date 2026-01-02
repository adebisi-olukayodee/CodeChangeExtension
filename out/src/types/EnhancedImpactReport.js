"use strict";
/**
 * Enhanced impact report with detailed breaking changes, rule IDs, and structured output.
 * This format provides comprehensive information about API changes and their impact.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BreakingChangeRule = void 0;
/**
 * Breaking change rule IDs for TypeScript API changes
 */
var BreakingChangeRule;
(function (BreakingChangeRule) {
    // Function changes
    BreakingChangeRule["FN_PARAM_REQUIRED"] = "TSAPI-FN-001";
    BreakingChangeRule["FN_PARAM_REMOVED"] = "TSAPI-FN-002";
    BreakingChangeRule["FN_PARAM_TYPE_CHANGED"] = "TSAPI-FN-003";
    BreakingChangeRule["FN_RETURN_TYPE_CHANGED"] = "TSAPI-FN-004";
    BreakingChangeRule["FN_REMOVED"] = "TSAPI-FN-005";
    BreakingChangeRule["FN_SIGNATURE_CHANGED"] = "TSAPI-FN-006";
    BreakingChangeRule["FN_OVERLOAD_CHANGED"] = "TSAPI-FN-007";
    // Class changes
    BreakingChangeRule["CLS_METHOD_REMOVED"] = "TSAPI-CLS-001";
    BreakingChangeRule["CLS_PROPERTY_REMOVED"] = "TSAPI-CLS-002";
    BreakingChangeRule["CLS_METHOD_SIGNATURE_CHANGED"] = "TSAPI-CLS-003";
    BreakingChangeRule["CLS_REMOVED"] = "TSAPI-CLS-004";
    // Interface changes
    BreakingChangeRule["IFACE_PROPERTY_REMOVED"] = "TSAPI-IF-001";
    BreakingChangeRule["IFACE_PROPERTY_REQUIRED"] = "TSAPI-IF-002";
    BreakingChangeRule["IFACE_PROPERTY_TYPE_CHANGED"] = "TSAPI-IF-003";
    BreakingChangeRule["IFACE_REMOVED"] = "TSAPI-IF-004";
    // Type alias changes
    // Following the user's recommended mapping:
    // TYPE-001: property removed
    // TYPE-002: type definition changed (generic fallback)
    // TYPE-003: property optional → required
    // TYPE-004: property type changed/narrowed
    BreakingChangeRule["TYPE_REMOVED"] = "TSAPI-TYPE-001";
    BreakingChangeRule["TYPE_DEFINITION_CHANGED"] = "TSAPI-TYPE-002";
    BreakingChangeRule["TYPE_PROPERTY_REQUIRED"] = "TSAPI-TYPE-003";
    BreakingChangeRule["TYPE_PROPERTY_TYPE_CHANGED"] = "TSAPI-TYPE-004";
    // Enum changes
    BreakingChangeRule["ENUM_MEMBER_REMOVED"] = "TSAPI-ENUM-001";
    BreakingChangeRule["ENUM_REMOVED"] = "TSAPI-ENUM-002";
    // Export changes
    BreakingChangeRule["EXPORT_REMOVED"] = "TSAPI-EXP-001";
    BreakingChangeRule["EXPORT_TYPE_CHANGED"] = "TSAPI-EXP-002";
})(BreakingChangeRule = exports.BreakingChangeRule || (exports.BreakingChangeRule = {}));
//# sourceMappingURL=EnhancedImpactReport.js.map