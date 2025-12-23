export interface CiTestRunEntry {
    id: number;
    name?: string | null;
    testSuite: string;
    status: string;
    duration?: number | null;
    errorMessage?: string | null;
    stackTrace?: string | null;
    metadata?: Record<string, any> | null;
    createdAt?: string;
    framework?: string | null;
    environment?: string | null;
    branch?: string | null;
    buildId: number;
    repoFullName?: string | null;
    commitHash?: string | null;
    workflowRunId?: string | null;
    buildStatus?: string | null;
    buildCreatedAt?: string | null;
    totalTests?: number | null;
    passedTests?: number | null;
    failedTests?: number | null;
    flakyTests?: number | null;
}

export interface CiBuildSummary {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
}

export interface CiBuildEntry {
    buildId: number;
    workflowRunId?: string;
    commitHash?: string;
    branch?: string;
    status?: string;
    repoFullName?: string;
    createdAt?: string;
    summary: CiBuildSummary;
    testRuns: CiTestRunEntry[];
}

export interface CiResultsPayload {
    builds: CiBuildEntry[];
    commitHash?: string;
    fetchedAt?: Date;
}

