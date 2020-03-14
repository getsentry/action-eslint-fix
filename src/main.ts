import * as path from 'path'

import * as core from '@actions/core'
import * as github from '@actions/github'
import * as Webhooks from '@octokit/webhooks'

import {exec} from '@actions/exec'

const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx']

async function getChangedFiles(): Promise<string[]> {
  let output = ''
  let error = ''
  core.debug(`getChangedFiles`)

  if (!process.env.GITHUB_EVENT_PATH) {
    core.debug('no event path')
    return []
  }

  const event = require(process.env
    .GITHUB_EVENT_PATH) as Webhooks.WebhookPayloadPullRequest

  core.debug(
    `getChangedFiles, ${event.pull_request.base.sha}, ${event.pull_request.head.sha}`
  )

  try {
    await exec(
      'git',
      [
        'diff-tree',
        '--diff-filter=d',
        '--no-commit-id',
        '--name-only',
        '-r',
        event.pull_request.base.sha,
        event.pull_request.head.sha
      ],
      {
        listeners: {
          stdout: (data: Buffer) => {
            output += data.toString()
          },
          stderr: (data: Buffer) => {
            error += data.toString()
          }
        }
      }
    )
  } catch {}

  if (error) {
    throw new Error(error)
  }

  return (
    output
      .trim()
      .split('\n')
      .filter(filename => EXTENSIONS.find(ext => filename.endsWith(ext))) || []
  )
}

async function run(): Promise<void> {
  try {
    const octokit = new github.GitHub(core.getInput('GITHUB_TOKEN'))
    const changedFiles = await getChangedFiles()
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

    if (!process.env.GITHUB_REPOSITORY) {
      return
    }

    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')

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
