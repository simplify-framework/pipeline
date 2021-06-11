#!/bin/bash
cd .simplify-pipeline
DOCKER_VOLUME=$(docker volume ls | grep -w "simplify-pipeline")
if [ -z "${DOCKER_VOLUME}" ]; then
   echo "Creating new volume: simplify-pipeline"
   docker volume create --driver local --opt type=none --opt device=$PWD --opt o=bind simplify-pipeline;
fi
if [ $? -eq 0 ]; then
   if [ -z "$1" ]; then echo "Missing argument: require stage argument to run - (ex bash pipeline.sh build [service])";
   elif [ -z "$2" ]; then echo "Missing argument: require stage argument to run - (ex bash pipeline.sh build eslint-sast)";
   else docker-compose -f docker-compose.yml -f docker-compose.$1.yml --project-name .simplify-pipeline build $2; fi
fi