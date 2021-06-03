const CUNDERLINE = '\x1b[4m'
const CRESET = '\x1b[0m'

const OPT_COMMANDS = [
    {
        name: "list", desc: "list all stages of this pipeline", options: [
            { name: "help", desc: "show a help for the list command" },
            { name: "file", desc: "specific a file input for pipeline" }
        ]
    }, {
        name: "create", desc: "create docker-compose.yml for a selected stage", options: [
            { name: "project", desc: "specify a project name for volume caching" },
            { name: "file", desc: "specific a file input for pipeline" }
        ]
    }
]

module.exports = {
    OPT_COMMANDS
}
