#!/bin/sh
set -e

cd "$CI_PRIMARY_REPOSITORY_PATH"

npm ci
npx cap sync ios
