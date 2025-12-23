import axios, { AxiosInstance } from 'axios';
import { CiTestRunEntry } from '../types/CiTypes';

interface ApiTestRun {
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
    build?: ApiBuild;
}

interface ApiBuild {
    id: number;
    commitHash?: string | null;
    repoFullName?: string | null;
    workflowRunId?: string | number | null;
    status?: string | null;
    branch?: string | null;
    createdAt?: string | null;
    totalTests?: number | null;
    passedTests?: number | null;
    failedTests?: number | null;
    flakyTests?: number | null;
}

export class CiResultsClient {
    private axiosInstance: AxiosInstance;

    constructor(backendUrl: string, apiToken?: string) {
        if (!backendUrl) {
            throw new Error('Backend URL is required');
        }

        const normalizedUrl = backendUrl.endsWith('/') ? backendUrl.slice(0, -1) : backendUrl;

        this.axiosInstance = axios.create({
            baseURL: normalizedUrl,
            timeout: 15000,
            headers: this.buildHeaders(apiToken)
        });
    }

    async fetchTestRuns(teamId: string, options: { limit?: number; offset?: number }): Promise<ApiTestRun[]> {
        const limit = options.limit ?? 200;
        const offset = options.offset ?? 0;

        const response = await this.axiosInstance.get(`/teams/${teamId}/test-runs`, {
            params: {
                limit,
                offset
            }
        });

        return response.data?.testRuns ?? [];
    }

    async fetchTestRunsForCommit(teamId: string, repoFullName: string, commitHash: string, options: { limit?: number } = {}): Promise<CiTestRunEntry[]> {
        const apiRuns = await this.fetchTestRuns(teamId, { limit: options.limit ?? 200, offset: 0 });

        const normalizedCommit = commitHash.toLowerCase();
        const normalizedRepo = repoFullName.toLowerCase();

        const filtered = apiRuns.filter(run => {
            const build = run.build;
            if (!build) {
                return false;
            }

            const buildCommit = (build.commitHash || '').toLowerCase();
            const buildRepo = (build.repoFullName || '').toLowerCase();

            return buildCommit === normalizedCommit && (!repoFullName || buildRepo === normalizedRepo);
        });

        return filtered.map(run => this.mapTestRun(run));
    }

    async fetchTestRunsForRepo(teamId: string, repoFullName: string, options: { limit?: number; offset?: number } = {}): Promise<CiTestRunEntry[]> {
        const apiRuns = await this.fetchTestRuns(teamId, { limit: options.limit ?? 200, offset: options.offset ?? 0 });
        const normalizedRepo = repoFullName.toLowerCase();

        const filtered = apiRuns.filter(run => {
            const buildRepo = (run.build?.repoFullName || '').toLowerCase();
            return normalizedRepo ? buildRepo === normalizedRepo : true;
        });

        return filtered.map(run => this.mapTestRun(run));
    }

    private mapTestRun(run: ApiTestRun): CiTestRunEntry {
        const build = run.build;

        return {
            id: run.id,
            name: run.name ?? undefined,
            testSuite: run.testSuite,
            status: run.status,
            duration: run.duration ?? undefined,
            errorMessage: run.errorMessage ?? undefined,
            stackTrace: run.stackTrace ?? undefined,
            metadata: run.metadata ?? undefined,
            createdAt: run.createdAt,
            framework: run.framework ?? undefined,
            environment: run.environment ?? undefined,
            branch: run.branch ?? undefined,
            buildId: build?.id ?? 0,
            repoFullName: build?.repoFullName ?? undefined,
            commitHash: build?.commitHash ?? undefined,
            workflowRunId: build?.workflowRunId !== undefined && build?.workflowRunId !== null ? String(build.workflowRunId) : undefined,
            buildStatus: build?.status ?? undefined,
            buildCreatedAt: build?.createdAt ?? undefined,
            totalTests: build?.totalTests ?? undefined,
            passedTests: build?.passedTests ?? undefined,
            failedTests: build?.failedTests ?? undefined,
            flakyTests: build?.flakyTests ?? undefined
        };
    }

    private buildHeaders(apiToken?: string) {
        if (apiToken && apiToken.trim().length > 0) {
            return {
                Authorization: `Bearer ${apiToken.trim()}`
            };
        }

        return {};
    }
}

