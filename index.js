const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const _ = require("lodash")
const express = require("express")
const fs = require("fs")
const axios = require("axios")
const ip = require("ip")
const prompts = require("prompts")
const prettyBytes = require("pretty-bytes")
const open = require('open');
const cliInstaller = require('./src/cli-installer')

const wifiManager = require('./src/wifi-manager')
const Utils = require("./src/utils")
const store = require('./src/store')
store.localIp = ip.address()

let tasmotaLiteHash = null

let argv = yargs(hideBin(process.argv))
    .command(['flash', '$0'], 'Flash sonoff device with Tasmota')
    .option('port', {
        alias: 'p',
        type: 'number',
        default: 3123,
        description: 'Port to run the web server'
    })
    .option('auto', {
        alias: 'a',
        type: 'boolean',
        default: false,
        description: 'If this option is present, it will execute the entire process without user interaction'
    })
    .option('no-update-bin', {
        alias: 'j',
        type: 'boolean',
        default: false,
        description: 'If this option is present, it will only download tasmota-lite.bin from github if the .bin file does not exists locally'
    })
    .option('wifi-ssid', {
        alias: 'wifi',
        type: 'text',
        default: null,
        description: 'SSID (name) of your wifi network'
    })
    .option('wifi-password', {
        alias: 'pass',
        type: 'text',
        default: null,
        description: 'Password of your wifi network'
    })
    .option('no-wifi-configuration', {
        alias: 'nwc',
        type: 'boolean',
        default: false,
        description: 'Prevent the script to search for itead and tasmota wifi networks on startup'
    })
    .help('h')
    .argv



// Initialize wifi module
// Absolutely necessary even to set interface to null

if (argv['wifi-ssid'] !== null || argv['wifi-password'] !== null) {
    store.lastConnectedWifiNetwork = {ssid: argv['wifi-ssid'], password: argv['wifi-password']}
}

start(argv.port, argv.auto, !argv['no-update-bin'], !argv['no-wifi-configuration']);

function configurePublicFolder() {
    const homedir = require("os").homedir()
    let publicFolderPath = require("path").join(homedir, ".config/tasmota-installer/" + store.publicFolder)
    fs.mkdirSync(publicFolderPath, { recursive: true })
    store.publicFolderPath = publicFolderPath
}

/*
 |--------------------------------------------------------------------------
 | Start
 |--------------------------------------------------------------------------
 */
function start(port, auto, updateBin, wifiSearchStartup) {

    configurePublicFolder()

    const app = express()

    app.use(function (req, res, next) {
        let range = req.header("Range")
        if (typeof range==="undefined") {
            next()
            return
        }
        let bytesSent = parseInt(req.header("Range").replace(/bytes=(([0-9])*)+-(([0-9])*)/g, "$3"))
        let percentage = (Math.round((bytesSent / store.binSize) * 100))
        console.log(percentage + "% - " + prettyBytes(bytesSent) + " of " + prettyBytes(store.binSize))

        if (percentage >= 100) {
            setTimeout(() => {
                console.log("🚀 Firmware uploaded successfully.")
                console.log("The device may be rebooting right now. You should see \"tasmota_xxxxx\" wifi network available to connect in a few moment.")
                cliInstaller.processDone();
            }, 3000)
        }
        next()
    })

    app.get("/", (req, res) => {
        res.send("Hello World!")
    })
    app.use(express.static(store.publicFolderPath))

    app.listen(port, () => {
        // console.log(`Server listening on port: ${port}`)

        cliInstaller.run(auto, updateBin, port, wifiSearchStartup)
    })

}

