#!/bin/bash

set -e

export SSH_KEY_FILE=~/Projects/bunch/begin-build/iso/credentials/id_rsa
export SOURCE=~/Projects/bunch/ffmpeg-process-manager/
export HOST=ubuntu@$1
export DESTINATION=/home/ubuntu/ffmpeg-process-manager/

ssh -i $SSH_KEY_FILE $HOST "rm -rf $DESTINATION"

rsync --exclude=node_modules -r -a -v -e "ssh -i $SSH_KEY_FILE" --delete $SOURCE $HOST:$DESTINATION

ssh -i $SSH_KEY_FILE $HOST "cd $DESTINATION && yarn install --ignore-engines"

while true; do 
  fswatch -1 .
  rsync --exclude=node_modules -r -a -v -e "ssh -i $SSH_KEY_FILE" --delete $SOURCE $HOST:$DESTINATION
done

