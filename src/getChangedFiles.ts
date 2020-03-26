import * as core from '@actions/core'
import * as github from '@actions/github'
import * as Webhooks from '@octokit/webhooks'

const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx']

export async function getChangedFiles(
  octokit: github.GitHub
): Promise<string[]> {
  core.debug(`getChangedFiles`)

  if (!process.env.GITHUB_EVENT_PATH) {
    core.debug('no event path')
    return []
  }

  const event = require(process.env
    .GITHUB_EVENT_PATH) as Webhooks.WebhookPayloadPullRequest

  const {owner, repo} = github.context.repo

  const options = octokit.pulls.listFiles.endpoint.merge({
    owner,
    repo,
    pull_number: event.pull_request.number, // eslint-disable-line @typescript-eslint/camelcase
    per_page: 100, // eslint-disable-line @typescript-eslint/camelcase
    page: 1
  })

  const files = await octokit.paginate(options)

  files.forEach(file => core.debug(`${file.filename} ${file.status}`))

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
