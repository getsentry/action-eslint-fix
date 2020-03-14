# getsentry/action-eslint-fix

Runs eslint (only on changed files in a PR), with `--fix` and commits the changes to the PR.


## Installation

Add the following to your workflow config

```yaml
    - name: Use current action
      uses: getsentry/action-eslint-fix@v1
      with:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

