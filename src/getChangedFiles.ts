import * as core from '@actions/core'
import * as github from '@actions/github'
import * as Webhooks from '@octokit/webhooks'

const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx']

type Octokit = ReturnType<typeof github.getOctokit>

export async function getChangedFiles(octokit: Octokit): Promise<string[]> {
  if (!process.env.GITHUB_EVENT_PATH) {
    core.debug('no event path')
    return []
  }

  const event = require(process.env
    .GITHUB_EVENT_PATH) as Webhooks.EventPayloads.WebhookPayloadPullRequest

  const {owner, repo} = github.context.repo

  const files = await octokit.paginate(octokit.pulls.listFiles, {
    owner,
    repo,
    pull_number: event.pull_request.number,
    per_page: 100,
    page: 1
  })

  // Do not return removed files, as we can't lint those
  // Not sure if there are other statuses we need to consider
  return files
    .filter(
      file =>
        file.status !== 'removed' &&
        EXTENSIONS.find(ext => file.filename.endsWith(ext))
    )
    .map(file => file.filename)
}
