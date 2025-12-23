"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CiResultsClient = void 0;
const axios_1 = __importDefault(require("axios"));
class CiResultsClient {
    constructor(backendUrl, apiToken) {
        if (!backendUrl) {
            throw new Error('Backend URL is required');
        }
        const normalizedUrl = backendUrl.endsWith('/') ? backendUrl.slice(0, -1) : backendUrl;
        this.axiosInstance = axios_1.default.create({
            baseURL: normalizedUrl,
            timeout: 15000,
            headers: this.buildHeaders(apiToken)
        });
    }
    async fetchTestRuns(teamId, options) {
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
    async fetchTestRunsForCommit(teamId, repoFullName, commitHash, options = {}) {
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
    async fetchTestRunsForRepo(teamId, repoFullName, options = {}) {
        const apiRuns = await this.fetchTestRuns(teamId, { limit: options.limit ?? 200, offset: options.offset ?? 0 });
        const normalizedRepo = repoFullName.toLowerCase();
        const filtered = apiRuns.filter(run => {
            const buildRepo = (run.build?.repoFullName || '').toLowerCase();
            return normalizedRepo ? buildRepo === normalizedRepo : true;
        });
        return filtered.map(run => this.mapTestRun(run));
    }
    mapTestRun(run) {
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
    buildHeaders(apiToken) {
        if (apiToken && apiToken.trim().length > 0) {
            return {
                Authorization: `Bearer ${apiToken.trim()}`
            };
        }
        return {};
    }
}
exports.CiResultsClient = CiResultsClient;
//# sourceMappingURL=CiResultsClient.js.map