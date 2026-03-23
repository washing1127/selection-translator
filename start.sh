#!/bin/bash
cd "$(dirname "$0")"
nohup ./node_modules/.bin/electron . > /dev/null 2>&1 &
