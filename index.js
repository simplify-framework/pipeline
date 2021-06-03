#!/usr/bin/env node
'use strict';
const YAML = require('yaml')
const path = require('path')
const fs = require('fs')
const fetch = require('node-fetch')
process.env.DISABLE_BOX_BANNER = true
const simplify = require('simplify-sdk')
const { options } = require('yargs');
const readlineSync = require('readline-sync');
const { OPT_COMMANDS } = require('./const')
const yargs = require('yargs');
const opName = `executePipeline`
const CERROR = '\x1b[31m'
const CGREEN = '\x1b[32m'
const CPROMPT = '\x1b[33m'
const CNOTIF = '\x1b[33m'
const CRESET = '\x1b[0m'
const CDONE = '\x1b[37m'
const CBRIGHT = '\x1b[37m'
const CUNDERLINE = '\x1b[4m'
const COLORS = function (name) {
    const colorCodes = ["\x1b[31m", "\x1b[32m", "\x1b[33m", "\x1b[34m", "\x1b[35m", "\x1b[36m", "\x1b[31m", "\x1b[32m", "\x1b[33m", "\x1b[34m", "\x1b[35m", "\x1b[36m", "\x1b[31m", "\x1b[32m", "\x1b[33m", "\x1b[34m", "\x1b[35m", "\x1b[36m", "\x1b[31m", "\x1b[32m", "\x1b[33m", "\x1b[34m", "\x1b[35m", "\x1b[36m", "\x1b[31m", "\x1b[32m", "\x1b[33m", "\x1b[34m", "\x1b[35m", "\x1b[36m"]
    return colorCodes[(name.toUpperCase().charCodeAt(0) - 65) % colorCodes.length]
}
const envFilePath = path.resolve('.env')
if (fs.existsSync(envFilePath)) {
    require('dotenv').config({ path: envFilePath })
}

const showBoxBanner = function () {
    console.log("╓───────────────────────────────────────────────────────────────╖")
    console.log(`║                 Simplify Pipeline - Version ${require('./package.json').version}             ║`)
    console.log("╙───────────────────────────────────────────────────────────────╜")
}

const getErrorMessage = function (error) {
    return error.message ? error.message : JSON.stringify(error)
}

const getOptionDesc = function (cmdOpt, optName) {
    const options = (OPT_COMMANDS.find(cmd => cmd.name == cmdOpt) || { options: [] }).options
    return (options.find(opt => opt.name == optName) || { desc: '' }).desc
}

var argv = yargs.usage('simplify-pipeline create|list [stage] [options]')
    .string('help').describe('help', 'display help for a specific command')
    .string('project').alias('p', 'project').describe('project', getOptionDesc('create', 'project'))
    .string('file').alias('f', 'file').describe('file', getOptionDesc('list', 'file'))
    .demandCommand(1).argv;

showBoxBanner()

function parseIncludes(yamlObject) {
    return new Promise((resolve, reject) => {
        let stages = [...yamlObject.stages]
        if (yamlObject.include) {
            let remoteUrls = []
            yamlObject.include.map(item => {
                if (item.local) {
                    if (fs.existsSync(path.resolve(item.local))) {
                        const ymlObj = fs.readFileSync(path.resolve(item.local)).toString()
                        const includedObj = YAML.parse(ymlObj)
                        yamlObject = { ...yamlObject, ...includedObj }
                        if (includedObj.stages) {
                            stages = [...stages, ...includedObj.stages]
                        }
                    }
                } else if (item.template) {
                    remoteUrls.push(`https://gitlab.com/gitlab-org/gitlab/-/raw/master/lib/gitlab/ci/templates/${item.template}`)
                }
            })
            function arrayBuffer2String(buf, callback) {
                var bb = new BlobBuilder();
                bb.append(buf);
                var f = new FileReader();
                f.onload = function (e) {
                    callback(e.target.result)
                }
                f.readAsText(bb.getBlob());
            }
            /** fetching remote templates from GitLab... */
            if (remoteUrls.length > 0) {
                Promise.all(remoteUrls.map((url) => fetch(url))).then((responses) => {
                    return Promise.all(responses.map((res) => res.text())).then((buffers) => {
                        return buffers.map((buffer) => {
                            return YAML.parse(buffer)
                        });
                    });
                }).then((finalObjects) => {
                    yamlObject.stages = [...new Set(stages)]
                    finalObjects.map(m => {
                        if (m.stages) {
                            stages = [...stages, ...m.stages]
                        }
                        yamlObject = { ...yamlObject, ...m }
                    })
                    yamlObject.stages = [...new Set(stages)]
                    resolve(yamlObject)
                });
            } else {
                yamlObject.stages = [...new Set(stages)]
                resolve(yamlObject)
            }
        } else {
            resolve(yamlObject)
        }
    })
}

var cmdOPS = (argv._[0] || 'create').toUpperCase()
var optCMD = (argv._.length > 1 ? argv._[1] : undefined)
var index = -1
const filename = argv['file'] || '.gitlab-ci.yml'
const projectName = argv['project'] || '.simplify-pipeline'
if (!fs.existsSync(path.resolve(`${filename}`))) {
    console.error(path.resolve(`${filename}`) + ' not found!')
    process.exit()
}
const file = fs.readFileSync(path.resolve(`${filename}`), 'utf8')
let yamlObject = YAML.parse(file)
if (yamlObject.include) {
    parseIncludes(yamlObject).then(result => {
        yamlObject = result
        if (cmdOPS == 'CREATE') {
            if (!optCMD) {
                index = readlineSync.keyInSelect(yamlObject.stages, `Select a stage to execute ?`, {
                    cancel: `${CBRIGHT}None${CRESET} - (Escape)`
                })
                optCMD = yamlObject.stages[index]
            } else {
                index = yamlObject.stages.indexOf(optCMD)
            }
            let dockerfileContent = ['FROM scratch']
            if (index >= 0) {
                const executedStage = yamlObject.stages[index]
                let dockerComposeContent = { version: '3.8', services: {}, volumes: {} }
                dockerComposeContent.volumes[`shared`] = {
                    "driver": "local",
                    "driver_opts": {
                        "type": "none",
                        "device": "$PWD",
                        "o": "bind"
                    }
                }
                let stageExecutionChains = []
                let dockerCacheVolumes = []
                let dockerBaseContent = [`FROM ${yamlObject.image}`, 'WORKDIR /source', 'VOLUME /source', 'COPY . /source']
                let dockerBasePath = `${projectName}/Dockerfile`
                const baseImage = `base-${yamlObject.image.split(':')[0]}`
                const baseDirName = path.dirname(path.resolve(dockerBasePath))
                if (!fs.existsSync(baseDirName)) {
                    fs.mkdirSync(baseDirName, { recursive: true })
                }
                if (yamlObject.cache && yamlObject.cache.paths && yamlObject.cache.paths.length) {
                    dockerCacheVolumes.push()
                }
                fs.writeFileSync(dockerBasePath, dockerBaseContent.join('\n'))
                dockerComposeContent.services[baseImage] = { build: { context: `../`, dockerfile: `${projectName}/Dockerfile`, args: {} } }

                const variables = simplify.getContentArgs(yamlObject.variables, { ...process.env })
                Object.keys(yamlObject).map((key, idx) => {
                    if (yamlObject[key].stage === executedStage) {
                        const stageName = `${idx}-${executedStage}.${key}`
                        dockerComposeContent.services[key] = { build: { context: `../`, dockerfile: `${projectName}/${stageName}.Dockerfile`, args: {} }, volumes: [`shared:/source`] }
                        stageExecutionChains.push(`${stageName}`)
                        dockerfileContent = [`FROM ${projectName.replace(/\./g, '')}_${baseImage}`, 'WORKDIR /source']
                        let dockerCommands = []
                        let dockerBeforeCommands = []

                        yamlObject[key].before_script.map(script => {
                            let scriptContent = script.startsWith('set ') ? script : simplify.getContentArgs(script, { ...process.env }, { ...variables })
                            if (scriptContent.startsWith('export ') || scriptContent.startsWith('set ')) {
                                let dockerOpts = scriptContent.startsWith('set ') ? 'ARG' : 'ENV'
                                scriptContent = scriptContent.replace('export ', '').replace('set ', '')
                                const argKeyValue = scriptContent.split('=')
                                dockerComposeContent.services[key].build.args[`${argKeyValue[0].trim()}`] = `${argKeyValue[1].trim()}`
                                scriptContent = `${argKeyValue[0].trim()}="${argKeyValue[1].trim()}"`
                                dockerfileContent.push(`${dockerOpts} ${scriptContent}`)
                            } else {
                                dockerBeforeCommands.push(`${scriptContent}`)
                            }
                        })

                        yamlObject[key].script.map(script => {
                            let scriptContent = script.startsWith('set ') ? script : simplify.getContentArgs(script, { ...process.env }, { ...variables })
                            if (scriptContent.startsWith('export ') || scriptContent.startsWith('set ')) {
                                let dockerOpts = scriptContent.startsWith('set ') ? 'ARG' : 'ENV'
                                scriptContent = scriptContent.replace('export ', '').replace('set ', '')
                                const argKeyValue = scriptContent.split('=')
                                dockerComposeContent.services[key].build.args[`${argKeyValue[0].trim()}`] = `${argKeyValue[1].trim()}`
                                scriptContent = `${argKeyValue[0].trim()}="${argKeyValue[1].trim()}"`
                                dockerfileContent.push(`${dockerOpts} ${scriptContent}`)
                            } else {
                                dockerCommands.push(`${scriptContent}`)
                            }
                        })
                        dockerfileContent.push(`RUN ${dockerBeforeCommands.join(' && ')}`)
                        dockerfileContent.push(`RUN ${dockerCommands.join(' && ')}`)
                        let dockerfilePath = `${projectName}/${stageName}.Dockerfile`
                        const pathDirName = path.dirname(path.resolve(dockerfilePath))
                        if (!fs.existsSync(pathDirName)) {
                            fs.mkdirSync(pathDirName, { recursive: true })
                        }
                        fs.writeFileSync(dockerfilePath, dockerfileContent.join('\n'))
                    }
                })
                let dockerComposePath = `${projectName}/docker-compose.${executedStage}.yml`
                fs.writeFileSync(dockerComposePath, YAML.stringify(dockerComposeContent))
                console.log(`Created ${projectName} docker-compose for stage '${optCMD}' cached to '${projectName}' volume`)
                fs.writeFileSync(`pipeline.sh`, [
                    '#!/bin/bash',
                    `cd ${projectName}`,
                    `docker volume rm ${projectName.replace(/\./g, '')}_shared > /dev/null`,
                    `docker-compose -f docker-compose.$1.yml --project-name ${projectName} up --force-recreate`
                ].join('\n'))
            }
        } else if (cmdOPS == 'LIST') {
            if (!optCMD) {
                yamlObject.stages.map((cmd, idx) => {
                    console.log(`\t- ${CPROMPT}${cmd.toLowerCase()}${CRESET}`)
                })
            } else {
                Object.keys(yamlObject).map((key, idx) => {
                    if (yamlObject[key].stage === optCMD) {
                        const stageName = `[${optCMD}] ${key}`
                        console.log(`\t- ${CPROMPT}${stageName.toLowerCase()}${CRESET}`)
                    }
                })
            }
        } else {
            yargs.showHelp()
            console.log(`\n`, ` * ${CBRIGHT}Supported command list${CRESET}:`, '\n')
            OPT_COMMANDS.map((cmd, idx) => {
                console.log(`\t- ${CPROMPT}${cmd.name.toLowerCase()}${CRESET} : ${cmd.desc}`)
            })
            console.log(`\n`)
            process.exit(0)
        }
    })
}
