#!/bin/sh
set -ex

brew install node

cd "$CI_PRIMARY_REPOSITORY_PATH"

npm ci
npx cap sync ios
