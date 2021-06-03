#!/usr/bin/env node
'use strict';
const YAML = require('yaml')
const path = require('path')
const fs = require('fs')
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
    .string('file').alias('f', 'file').describe('file', getOptionDesc('file', 'file'))
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
const yamlObject = YAML.parse(file)
if (cmdOPS == 'CREATE') {
    if (!optCMD) {
        index = readlineSync.keyInSelect(yamlObject.stages, `Select a stage to execute ?`, {
            cancel: `${CBRIGHT}None${CRESET} - (Escape)`
        })
    } else {
        index = yamlObject.stages.indexOf(optCMD)
    }
    let dockerfileContent = ['FROM scratch']
    if (index >= 0) {
        const executedStage = yamlObject.stages[index]
        let dockerComposeContent = { version: '3.8', services: {}, volumes: {} }
        dockerComposeContent.volumes[`${projectName}`] = {
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
        const baseImage = `base-${projectName.replace(/\./g, '')}`
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
                dockerComposeContent.services[key] = { build: { context: `../`, dockerfile: `${projectName}/${stageName}.Dockerfile`, args: {} }, volumes: [`${projectName}:/source`] }
                stageExecutionChains.push(`${stageName}`)
                dockerfileContent = [`FROM ${projectName.replace(/\./g, '')}_${baseImage}`, 'WORKDIR /source']
                let dockerCommands = []
                simplify.getContentArgs(yamlObject[key].script, { ...process.env }, { ...variables }).map(script => {
                    let scriptContent = script
                    if (script.startsWith('export ')) {
                        let dockerOpts = 'ENV'
                        scriptContent = script.replace('export ', '')
                        const argKeyValue = scriptContent.split('=')
                        dockerComposeContent.services[key].build.args[`${argKeyValue[0].trim()}`] = `${argKeyValue[1].trim()}`
                        scriptContent = `${argKeyValue[0].trim()}="${argKeyValue[1].trim()}"`
                        dockerfileContent.push(`${dockerOpts} ${scriptContent}`)
                    } else {
                        dockerCommands.push(`RUN ${scriptContent}`)
                    }
                })
                dockerfileContent.push(`${dockerCommands.join('\n')}`)
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
        fs.writeFileSync(`pipeline.bash`, [
            '#!/bin/bash',
            `cd ${projectName}`,
            `docker-compose -f docker-compose.$1.yml up --force-recreate`
        ].join('\n'))
    }
} else if (cmdOPS == 'LIST') {
    yamlObject.stages.map((cmd, idx) => {
        console.log(`\t- ${CPROMPT}${cmd.toLowerCase()}${CRESET}`)
    })
} else {
    yargs.showHelp()
    console.log(`\n`, ` * ${CBRIGHT}Supported command list${CRESET}:`, '\n')
    OPT_COMMANDS.map((cmd, idx) => {
        console.log(`\t- ${CPROMPT}${cmd.name.toLowerCase()}${CRESET} : ${cmd.desc}`)
    })
    console.log(`\n`)
    process.exit(0)
}
