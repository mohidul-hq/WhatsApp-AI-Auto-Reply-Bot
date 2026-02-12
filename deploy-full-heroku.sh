#!/usr/bin/env bash
# Deploy the repo to Heroku using your local .env for config (DOES NOT commit .env).
# Usage: ./deploy-full-heroku.sh <heroku-app-name>
# NOTE: You must run this locally where you are logged in to Heroku CLI.

set -euo pipefail
APP_NAME=${1:-}
if [[ -z "$APP_NAME" ]]; then
  echo "Usage: $0 <heroku-app-name>"
  exit 1
fi

if ! command -v heroku >/dev/null 2>&1; then
  echo "Heroku CLI not found. Install and login first: https://devcenter.heroku.com/articles/heroku-cli"
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git not found. Install git and ensure you're in the project repo."
  exit 1
fi

if [[ ! -f ".env" ]]; then
  echo ".env file not found in the repo root. Create it from .env.example and re-run."
  exit 1
fi

echo "Configuring Heroku buildpacks for $APP_NAME"
heroku buildpacks:clear -a "$APP_NAME"
heroku buildpacks:add --index 1 https://github.com/jontewks/puppeteer-heroku-buildpack -a "$APP_NAME"
heroku buildpacks:add --index 2 heroku/nodejs -a "$APP_NAME"

# Common chrome path used by these buildpacks
heroku config:set PUPPETEER_EXECUTABLE_PATH=/app/.apt/usr/bin/google-chrome-stable -a "$APP_NAME"
heroku config:set PUPPETEER_SKIP_DOWNLOAD=true -a "$APP_NAME"

# Load .env and set each var on Heroku (skip empty lines and comments)
echo "Setting config vars on Heroku from local .env (sensitive values will be sent to Heroku)."
while IFS= read -r line || [[ -n "$line" ]]; do
  # Trim leading/trailing whitespace
  trimmed=$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  # Skip comments and empty lines
  [[ -z "$trimmed" ]] && continue
  [[ "$trimmed" =~ ^# ]] && continue
  # Remove export keyword if present
  trimmed=${trimmed#export }
  # Parse name and value (value may contain =)
  name=${trimmed%%=*}
  value=${trimmed#*=}
  # Trim surrounding quotes from value
  value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
  if [[ -z "$name" ]]; then
    continue
  fi
  echo "  Setting $name"
  heroku config:set "$name=$value" -a "$APP_NAME"
done < .env

# Ensure heroku git remote exists
heroku git:remote -a "$APP_NAME" || true

echo "Pushing to Heroku (git push heroku main). This may take a few minutes."
git push heroku main

echo "Restarting dynos and tailing logs"
heroku ps:restart -a "$APP_NAME"
heroku logs --tail -a "$APP_NAME"
