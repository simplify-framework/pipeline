### HOW TO: Simplify Pipeline

npm install -g simplify-pipeline

simplify-pipeline -f .gitlab-ci.yml list

- build
- test
- deploy

simplify-pipeline -f .gitlab-ci.yml create build

