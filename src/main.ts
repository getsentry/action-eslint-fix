import * as path from 'path'

import * as core from '@actions/core'
import {exec} from '@actions/exec'
import * as github from '@actions/github'
import * as Webhooks from '@octokit/webhooks'

const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx']

async function getChangedFiles(octokit: github.GitHub): Promise<string[]> {
  core.debug(`getChangedFiles`)

  if (!process.env.GITHUB_EVENT_PATH) {
    core.debug('no event path')
    return []
  }

  const event = require(process.env
    .GITHUB_EVENT_PATH) as Webhooks.WebhookPayloadPullRequest

  const {owner, repo} = github.context.repo

  // Get SHA of the first commit of this PR so that we only lint files changed in the PR
  const {data: files} = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: event.pull_request.number,
    per_page: 100,
    page: 1
  })

  return files
    .filter(
      file =>
        file.status !== 'd' &&
        EXTENSIONS.find(ext => file.filename.endsWith(ext))
    )
    .map(file => file.filename)
}

async function run(): Promise<void> {
  try {
    const {owner, repo} = github.context.repo
    const token = core.getInput('GITHUB_TOKEN')

    if (!token) {
      core.debug(`NO GITHUB_TOKEN`)
    }

    const octokit = new github.GitHub(token)

    const changedFiles = await getChangedFiles(octokit)
    core.debug(changedFiles.join(', '))

    let results: any = []

    let eslintOutput = ''
    let eslintError = ''
    try {
      await exec(
        'node',
        [
          path.join(process.cwd(), 'node_modules/eslint/bin/eslint'),
          `--fix-dry-run`,
          '--format',
          'json',
          ...changedFiles
        ],
        {
          silent: true,
          listeners: {
            stdout: (data: Buffer) => {
              eslintOutput += data.toString()
            },
            stderr: (data: Buffer) => {
              eslintError += data.toString()
            }
          }
        }
      )
    } catch {}

    core.debug(`error running eslint: ${eslintError}`)

    try {
      results = JSON.parse(eslintOutput)
      const stylish = require('eslint/lib/formatters/stylish')

      // log to console so github action problem matchers can work on output
      console.log(stylish(results)) // eslint-disable-line no-console

      if (results.find(({errorCount}: any) => errorCount > 0)) {
        core.setFailed('eslint completed with errors')
      }
    } catch (err) {
      core.setFailed(err.message)
    }

    for (const result of results) {
      const filePath = result.filePath.replace(
        `${process.env.GITHUB_WORKSPACE}/`,
        ''
      )

      let file

      if (result.output) {
        try {
          core.debug(`getContents: ${filePath}`)
          const {data} = await octokit.repos.getContents({
            owner,
            repo,
            path: filePath,
            ref: process.env.GITHUB_HEAD_REF
          })
          file = data
        } catch (err) {
          core.debug(err.message)
        }

        if (!file || Array.isArray(file)) {
          return
        }

        // Commit eslint fixes
        octokit.repos.createOrUpdateFile({
          owner,
          repo,
          path: filePath,
          sha: file.sha,
          message: 'style(): Auto eslint fix',
          content: Buffer.from(result.output).toString('base64'),
          branch: process.env.GITHUB_HEAD_REF
        })
      }
    }
  } catch (error) {
    core.debug(error.stack)
    core.setFailed(error.message)
  }
}

run()
