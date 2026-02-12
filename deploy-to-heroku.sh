#!/usr/bin/env bash
# Helper script to configure Heroku buildpacks and env vars for this repo.
# Usage: ./deploy-to-heroku.sh <app-name> <CHAT_API_KEY>

set -euo pipefail
APP_NAME="$1"
CHAT_API_KEY="$2"

echo "Configuring buildpacks for $APP_NAME"
heroku buildpacks:clear -a "$APP_NAME"
heroku buildpacks:add --index 1 https://github.com/jontewks/puppeteer-heroku-buildpack -a "$APP_NAME"
heroku buildpacks:add --index 2 heroku/nodejs -a "$APP_NAME"

echo "Setting environment variables"
heroku config:set PUPPETEER_EXECUTABLE_PATH=/app/.apt/usr/bin/google-chrome-stable -a "$APP_NAME"
heroku config:set PUPPETEER_SKIP_DOWNLOAD=true -a "$APP_NAME"
heroku config:set CHAT_API_KEY="$CHAT_API_KEY" -a "$APP_NAME"

echo "Adding heroku git remote (if missing)"
heroku git:remote -a "$APP_NAME"

echo "Done. You can now deploy with: git push heroku main"
