#!/bin/bash
# Mavricks Backend Deployment Script
# Automates local packaging, server upload, remote extraction, PM2 restart, health checks, and rollback on failure.

set -e

PEM_KEY="/Users/saavan/Downloads/saavanx.pem"
SERVER_IP="34.229.1.55"
USER="ubuntu"
REMOTE_PATH="/var/www/mavricks-backend"
BACKUP_PATH="/var/www/mavricks-backend.bak"
TAR_FILE="/Users/saavan/Downloads/mavricks-backend.tar.gz"

echo "=== Step 1: Tarring local codebase ==="
tar -czf "$TAR_FILE" --exclude=node_modules --exclude=.git -C "/Users/saavan/Documents/GitHub/mavricks-node" .

echo "=== Step 2: Uploading tarball to server ==="
scp -i "$PEM_KEY" "$TAR_FILE" "$USER@$SERVER_IP:/home/$USER/mavricks-backend.tar.gz"
rm -f "$TAR_FILE"

echo "=== Step 3: Executing remote deployment and verification ==="
ssh -i "$PEM_KEY" "$USER@$SERVER_IP" "
  set -e
  echo 'Creating backup of existing deployment...'
  sudo rm -rf $BACKUP_PATH
  if [ -d $REMOTE_PATH ]; then
    sudo cp -r $REMOTE_PATH $BACKUP_PATH
  fi

  echo 'Extracting new codebase...'
  sudo mkdir -p $REMOTE_PATH
  sudo chown -R $USER:$USER $REMOTE_PATH
  tar -xzf /home/$USER/mavricks-backend.tar.gz -C $REMOTE_PATH
  rm -f /home/$USER/mavricks-backend.tar.gz
  find $REMOTE_PATH -name '._*' -delete

  echo 'Installing npm dependencies...'
  cd $REMOTE_PATH
  npm install --omit=dev

  echo 'Restarting application in PM2...'
  pm2 restart mavricks-backend || pm2 start server.js --name 'mavricks-backend'

  echo 'Verifying health check...'
  sleep 2
  HEALTH_CHECK=\$(curl -s http://localhost:4000/health)
  if [[ \$HEALTH_CHECK == *'\"ok\":true'* ]]; then
    echo '✔ Deployment successful and healthy!'
    pm2 save
  else
    echo '❌ Health check failed! Rolling back...'
    sudo rm -rf $REMOTE_PATH
    if [ -d $BACKUP_PATH ]; then
      sudo cp -r $BACKUP_PATH $REMOTE_PATH
      cd $REMOTE_PATH
      pm2 restart mavricks-backend
      echo '✔ Rollback completed successfully.'
    else
      echo '❌ No backup found to rollback!'
    fi
    exit 1
  fi
"
