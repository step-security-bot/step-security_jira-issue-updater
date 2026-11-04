import { error, info, setFailed, setOutput, setSecret } from "@actions/core";
import { getInputs, getLoginData } from "./config";
import { createPayload } from "./payload";
import { sendRequest } from "./request";
import axios, { AxiosError, isAxiosError } from "axios";
import * as core from "@actions/core";
import * as fs from "fs";

let hasErrors = false;
const success: string[] = [];
const failed: string[] = [];

async function validateSubscription() {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    let repoPrivate: boolean | undefined;

    if (eventPath && fs.existsSync(eventPath)) {
        const eventData = JSON.parse(fs.readFileSync(eventPath, "utf8"));
        repoPrivate = eventData?.repository?.private;
    }

    const upstream = "frieder/jira-issue-updater";
    const action = process.env.GITHUB_ACTION_REPOSITORY;
    const docsUrl = "https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions";

    core.info("");
    core.info("\u001b[1;36mStepSecurity Maintained Action\u001b[0m");
    core.info(`Secure drop-in replacement for ${upstream}`);
    if (repoPrivate === false) core.info("\u001b[32m\u2713 Free for public repositories\u001b[0m");
    core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`);
    core.info("");

    if (repoPrivate === false) return;

    const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
    const body: Record<string, string> = { action: action || "" };
    if (serverUrl !== "https://github.com") body.ghes_server = serverUrl;
    try {
        await axios.post(
            `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
            body,
            { timeout: 3000 }
        );
    } catch (error) {
        if (isAxiosError(error) && error.response?.status === 403) {
            core.error(
                `\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m`
            );
            core.error(`\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`);
            process.exit(1);
        }
        core.info("Timeout or API not reachable. Continuing to next step.");
    }
}

// Serializes only non-sensitive fields: AxiosError.toJSON() includes the request config,
// which holds the Jira email and API token (config.auth).
function describeError(err: any): string {
    return JSON.stringify({
        name: err?.name,
        message: err?.message,
        code: err?.code,
        status: err?.response?.status,
        data: err?.response?.data,
    });
}

async function run() {
    await validateSubscription();

    const login = getLoginData();
    setSecret(login.token);
    const inputs = getInputs();
    const payload = createPayload(inputs);

    const promises: Promise<void>[] = [];

    for (const issue of inputs.issue) {
        promises.push(
            sendRequest(login, issue, inputs, payload)
                .then(() => {
                    success.push(issue);
                    info(`Update of Jira issue [${issue}] successful.`);
                })
                .catch((err: AxiosError) => {
                    if (inputs.failOnError) {
                        setFailed(`Update of Jira issue ${issue} failed`);
                    } else {
                        hasErrors = true;
                        failed.push(issue);
                        info(`Update of Jira issue ${issue} failed`);
                    }
                    error(describeError(err));
                })
        );
    }

    await Promise.all(promises).then(() => {
        setOutput("hasErrors", hasErrors);
        setOutput("successful", success.join(inputs._issueDelimiter));
        setOutput("failed", failed.join(inputs._issueDelimiter));
    });
}

run().catch((err: any) => {
    setFailed("An unexpected exception has occurred. Check debug output for more info");
    error(describeError(err));
});
