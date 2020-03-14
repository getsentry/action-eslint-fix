import * as path from 'path'

import * as core from '@actions/core'
import * as github from '@actions/github'
import * as Webhooks from '@octokit/webhooks'

import {exec} from '@actions/exec'

const EXTENSIONS = ['js', 'jsx', 'ts', 'tsx']

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

    let myOutput = ''
    let myError = ''
    try {
      await exec(
        'node',
        [
          path.join(process.cwd(), 'node_modules/eslint/bin/eslint'),
          '--ext',
          EXTENSIONS.join(','),
          `--fix-dry-run`,
          '--format',
          'json',
          ...changedFiles
        ],
        {
          silent: true,
          listeners: {
            stdout: (data: Buffer) => {
              myOutput += data.toString()
            },
            stderr: (data: Buffer) => {
              myError += data.toString()
            }
          }
        }
      )
    } catch {}

    core.debug(`error${myError}`)

    let results = []
    try {
      results = JSON.parse(myOutput)
      const stylish = require('eslint/lib/formatters/stylish')

      core.debug('myOutput' + myOutput)
      console.log(stylish(results))
    } catch (err) {
      core.setFailed(err.message)
    }

    // core.debug(myOutput)

    /**
    const cli = new CLIEngine({
      // configFile: path.join(
      // process.env.GITHUB_WORKSPACE || '',
      // '.eslintrc.json'
      // ),
      // configFile: files[0],
      // useEslintrc: false,
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      fix: true
    })

    core.debug(`cwd: ${process.cwd()}`)

    if (!changedFiles.length) {
      core.debug('No changed files')
      return
    }

    core.debug(
      changedFiles
        .map((changedFile: string) =>
          path.join(process.env.GITHUB_WORKSPACE || '', changedFile)
        )
        .join(', ')
    )
    // This is probably going to fail on filenames with a space?
    const report = cli.executeOnFiles(
      changedFiles
        .map((changedFile: string) =>
          path.join(process.env.GITHUB_WORKSPACE || '', changedFile)
        )
    )

    core.debug(JSON.stringify(report, null, 2))
     **/

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
