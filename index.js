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
    .string('file').alias('f', 'file').describe('file', getOptionDesc('list', 'file')).default('.gitlab-ci.yml')
    .demandCommand(1).argv;

showBoxBanner()


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
function getVolumeName(projectName) {
    return projectName.replace(/[&\/\\#,+()$~%.'":*?<>{}]/g, '')
}
function getImageName(image) {
    return typeof image === 'object' ? image.name : image
}
const getContentArgs = function (...args) {
    var template = args.shift()
    function parseVariables(v) {
        args.forEach(function (a) {
            if (typeof a === 'object') {
                Object.keys(a).map(function (i) {
                    if (a[i]) {
                        v = v.replace(new RegExp('\\${' + i + '}', 'g'), a[i])
                        const regxMatches = new RegExp('\\$' + i, 'g')
                        const valueMatches = ('$' + i).match(regxMatches)
                        if (valueMatches && valueMatches[0] === ('$' + i)) {
                            v = v.replace(regxMatches, a[i])
                        }
                    }
                })
            } else {
                v = v.replace(new RegExp('\\${' + a + '}', 'g'), a)
                const regxMatches = new RegExp('^\\$' + a, 'g')
                const valueMatches = ('$' + a).match(regxMatches)
                if (valueMatches && valueMatches[0] === ('$' + a)) {
                    v = v.replace(regxMatches, a)
                }
            }
        })
        Object.keys(process.env).map(function (e) {
            v = v.replace(new RegExp('\\${' + e + '}', 'g'), process.env[e])
            v = v.replace(new RegExp('\\$' + e, 'g'), process.env[e])
        })
        if (typeof args[args.length - 1] === 'boolean' && args[args.length - 1] === true) {
            v = v.replace(new RegExp(/ *\{[^)]*\} */, 'g'), `(not set)`).replace(new RegExp('\\$', 'g'), '')
            v = v.replace(new RegExp(/ *\[^)]*\ */, 'g'), `(not set)`).replace(new RegExp('\\$', 'g'), '')
        }
        return v
    }
    function parseKeyValue(obj) {
        if (typeof obj !== 'object') {
            obj = parseVariables(obj)
        } else {
            Object.keys(obj).map(function (k, i) {
                if (typeof obj[k] === 'string') {
                    obj[k] = parseVariables(obj[k])
                } else if (Array.isArray(obj)) {
                    obj[i] = parseKeyValue(obj[i])
                } else if (typeof obj[k] === 'object') obj[k] = parseKeyValue(obj[k])
            })
        }
        return obj
    }
    return parseKeyValue(template)
}
function objectMerges(...sources) {
    let acc = {}
    for (const source of sources) {
        if (source instanceof Array) {
            if (!(acc instanceof Array)) {
                acc = []
            }
            acc = [...acc, ...source]
        } else if (source instanceof Object) {
            for (let [key, value] of Object.entries(source)) {
                if (value instanceof Object && key in acc) {
                    value = objectMerges(acc[key], value)
                }
                acc = { ...acc, [key]: value }
            }
        }
    }
    return acc
}

function parseIncludes(yamlObject) {
    return new Promise((resolve, reject) => {
        let stages = [...yamlObject.stages]
        let variables = { ...yamlObject.variables }
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
                        if (includedObj.variables) {
                            variables = objectMerges(variables, includedObj.variables)
                        }
                    }
                } else if (item.template) {
                    remoteUrls.push(`https://gitlab.com/gitlab-org/gitlab/-/raw/master/lib/gitlab/ci/templates/${item.template}`)
                } else if (item.remote) {
                    remoteUrls.push(item.remote)
                } else if (typeof item === 'object') {
                    /** project ref: { file, project, ref } */
                    if (Array.isArray(item.file)) {
                        item.file.map(file => remoteUrls.push(`https://gitlab.com/${item.project}/-/raw/${item.ref}/${file}`))
                    } else {
                        remoteUrls.push(`https://gitlab.com/${item.project}/-/raw/${item.ref}/${item.file}`)
                    }
                }
            })
            /** fetching templates from remoteUrls... */
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
                        if (m.variables) {
                            variables = objectMerges(variables, m.variables)
                        }
                        yamlObject = { ...yamlObject, ...m }
                    })
                    yamlObject.stages = [...new Set(stages)]
                    yamlObject.variables = variables
                    resolve(yamlObject)
                });
            } else {
                yamlObject.stages = [...new Set(stages)]
                yamlObject.variables = variables
                resolve(yamlObject)
            }
        } else {
            resolve(yamlObject)
        }
    })
}

const yamlProcessor = function (yamlObject) {
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
            dockerComposeContent.volumes[`${getVolumeName(projectName)}`] = { external: true }
            let stageExecutionChains = []
            let dockerCacheVolumes = []
            let dockerBaseContent = [`FROM ${getImageName(yamlObject.image)}`, 'WORKDIR /source', 'VOLUME /data', 'COPY . /source', 'CMD ls -la /source']
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
            fs.writeFileSync(`${projectName}/docker-compose.yml`, YAML.stringify(dockerComposeContent))

            dockerComposeContent.services = {} /** reset docker-compose services section */
            delete dockerComposeContent.volumes /** remove docker-compose volumes section */
            let variables = getContentArgs(yamlObject.variables || {}, { ...process.env })
            function parseScriptContent(scriptLine, dockerCommands, dockerfileContent, service, localVariables) {
                let scriptContent = scriptLine.startsWith('set ') ? scriptLine : getContentArgs(scriptLine, { ...process.env }, { ...localVariables })
                if (scriptContent.startsWith('export ') || scriptContent.startsWith('set ')) {
                    let dockerOpts = scriptContent.startsWith('set ') ? 'ARG' : 'ENV'
                    scriptContent = scriptContent.replace('export ', '').replace('set ', '')
                    const argKeyValue = scriptContent.split('=')
                    service.build.args[`${argKeyValue[0].trim()}`] = `${argKeyValue[1].trim()}`
                    scriptContent = `${argKeyValue[0].trim()}="${argKeyValue[1].trim()}"`
                    dockerfileContent.push(`${dockerOpts} ${scriptContent}`)
                } else {
                    dockerCommands.push(`${scriptContent}`)
                }
            }
            Object.keys(yamlObject).map((key, idx) => {
                if (yamlObject[key].extends) {
                    if (Array.isArray(yamlObject[key].extends)) {
                    } else {
                        yamlObject[yamlObject[key].extends].disabled = false
                        yamlObject[key] = { ...yamlObject[yamlObject[key].extends], ...yamlObject[key] }
                        yamlObject[yamlObject[key].extends].disabled = true
                    }
                }
                let localVariables = getContentArgs(yamlObject[key].variables || {}, variables)
                yamlObject[key].secrets && Object.keys(yamlObject[key].secrets).map(secret => {
                    localVariables[secret] = "${" + secret + "}"
                })
                localVariables = objectMerges(variables, localVariables) /** merge global variables with local variables */
                if (yamlObject[key].stage === executedStage && !yamlObject[key].disabled && !key.startsWith('.')) {
                    const stageName = `${idx}-${executedStage}.${key}`
                    dockerComposeContent.services[key] = { build: { context: `../`, dockerfile: `${projectName}/${stageName}.Dockerfile`, args: {} }, volumes: [`${getVolumeName(projectName)}:/data`] }
                    stageExecutionChains.push(`${stageName}`)
                    const localImage = `${yamlObject[key].image ? getContentArgs({ image: getImageName(yamlObject[key].image) }, localVariables).image : `${projectName.replace(/\./g, '')}_${baseImage}`}`
                    dockerfileContent = [`FROM ${localImage}`, 'WORKDIR /source']
                    yamlObject[key].dependencies && yamlObject[key].dependencies.map(deps => {
                        dockerfileContent.push(`FROM ${projectName.replace(/\./g, '')}_${deps}`)
                    })
                    let dockerCommands = []
                    let dockerBeforeCommands = []
                    let dockerAfterCommands = []
                    /**
                     * extends - inherit from another stage
                     * services - run another docker inside the build image
                     * needs - to execute jobs out-of-order (depend on other jobs)
                     */
                    yamlObject[key].before_script && yamlObject[key].before_script.map(scriptLine => {
                        parseScriptContent(scriptLine, dockerBeforeCommands, dockerfileContent, dockerComposeContent.services[key], localVariables)
                    })
                    yamlObject[key].script && yamlObject[key].script.map(scriptLine => {
                        parseScriptContent(scriptLine, dockerCommands, dockerfileContent, dockerComposeContent.services[key], localVariables)
                    })
                    yamlObject[key].after_script && yamlObject[key].after_script.map(scriptLine => {
                        parseScriptContent(scriptLine, dockerAfterCommands, dockerfileContent, dockerComposeContent.services[key], localVariables)
                    })

                    dockerBeforeCommands.length && dockerfileContent.push(`RUN ${dockerBeforeCommands.join(' && ')}`)
                    dockerCommands.length && dockerfileContent.push(`RUN ${dockerCommands.join(' && ')}`)
                    dockerAfterCommands.length && dockerfileContent.push(`RUN ${dockerAfterCommands.join(' && ')}`)
                    let dockerfilePath = `${projectName}/${stageName}.Dockerfile`
                    const pathDirName = path.dirname(path.resolve(dockerfilePath))
                    if (!fs.existsSync(pathDirName)) {
                        fs.mkdirSync(pathDirName, { recursive: true })
                    }
                    dockerfileContent = getContentArgs(dockerfileContent, localVariables)
                    fs.writeFileSync(dockerfilePath, dockerfileContent.join('\n'))
                }
            })
            let dockerComposePath = `${projectName}/docker-compose.${executedStage}.yml`
            fs.writeFileSync(dockerComposePath, YAML.stringify(dockerComposeContent))
            console.log(`Created ${projectName} docker-compose for stage '${optCMD}' cached to '${projectName}' volume`)
            fs.writeFileSync(`pipeline.sh`, [
                '#!/bin/bash',
                `cd ${projectName}`,
                `DOCKER_VOLUME=$(docker volume ls | grep -w "${getVolumeName(projectName)}")`,
                'if [ -z "${DOCKER_VOLUME}" ]; then',
                `   echo "Creating new volume: ${getVolumeName(projectName)}"`,
                `   docker volume create --driver local --opt type=none --opt device=$PWD --opt o=bind ${getVolumeName(projectName)};`,
                `fi`,
                `if [ $? -eq 0 ]; then`,
                `   if [ -z "$1" ]; then echo "Missing argument: require stage argument to run - (ex bash pipeline.sh build [service])";`,
                `   elif [ -z "$2" ]; then echo "Missing argument: require stage argument to run - (ex bash pipeline.sh build eslint-sast)";`,
                `   else docker-compose -f docker-compose.yml -f docker-compose.$1.yml --project-name ${projectName} build $2; fi`,
                `fi`
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
}
if (yamlObject.include) {
    parseIncludes(yamlObject).then(result => {
        yamlProcessor(result)
    })
} else {
    yamlProcessor(yamlObject)
}