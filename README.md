### HOW TO: Simplify Pipeline

![NPM Downloads](https://img.shields.io/npm/dw/simplify-pipeline)
![Package Version](https://img.shields.io/github/package-json/v/simplify-framework/pipeline?color=green)

npm install -g simplify-pipeline

Example .gitlab-ci.yml file:

```yaml
image: node:lts-stretch
stages:
  - build
  - test

package-build:
  stage: build
  before_script:
  - mkdir -p /root/.aws/
  - echo "[default]" > /root/.aws/credentials
  - echo "[default]" > /root/.aws/config
  script:
  - echo "TEST_FILE_CREAED-1" >> test-file.json

package-test:
  stage: test
  dependencies:
  - package-build
  script:
  - ls -la && cat test-file.json
  - cat .gitlab-ci.yml
```
simplify-pipeline -f .gitlab-ci.yml list

- build
- test

Run the `build` stage:
```bash
simplify-pipeline -f .gitlab-ci.yml create build
bash pipeline.sh build package-build
```

Run the `test` stage:
```bash
simplify-pipeline -f .gitlab-ci.yml create test
bash pipeline.sh test package-test

```
