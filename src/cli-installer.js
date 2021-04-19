const Utils = require("./utils")
const wifiManager = require("./wifi-manager")
const sonoffApi = require("./sonoff-api")
const tasmotaApi = require("./tasmota-api")
const prompts = require("prompts")
const fs = require("fs")
const prettyBytes = require("pretty-bytes")
const store  = require("./store")

const binDownloadUrl = "https://ota.tasmota.com/tasmota/release/tasmota-lite.bin";

class CliInstaller {
    constructor() {
        this.withUserInteraction = true
        this.alwaysUpdateBin = true
        this.port = 3123
    }

    async run(withUserInteraction, alwaysUpdateBin, port, wifiSearchStartup) {
        this.withUserInteraction = withUserInteraction
        this.alwaysUpdateBin = alwaysUpdateBin
        this.port = port

        let configuredAutomatically = false
        if (wifiSearchStartup) {
            try {
                let connection = await wifiManager.connectToIteadWifi()
                console.log("Connected to " + connection.ssid + ". Waiting 12 seconds to configure the AP")
                await Utils.waitAsync(12000)
                console.log("Connected.")
                await this.configureIteadAp()

                //Connect to the configured network
                console.log("Connecting to " + store.lastSavedWifiCredentials.ssid + " network")
                await wifiManager.connectToWifi(store.lastSavedWifiCredentials.ssid, store.lastSavedWifiCredentials.password)
                console.log("Connected.")
                configuredAutomatically = true
            } catch (e) {
                console.log("Error: ", e)
                try {
                    await Utils.waitAsync(2000)
                    let result = await this.configureTasmota()
                    if (result) {
                        process.exit()
                    }
                } catch (e) {
                    console.log("Error: ", e)
                }
            }
        }
        if (!configuredAutomatically && !withUserInteraction) {
            let response = await this.confirmIsReady()
            if (!response) {
                process.exit(0)
                return
            }
        } else {
            if (configuredAutomatically) {
                console.log("Waiting 20 seconds to let the device connect to your network too")
                await Utils.waitAsync(20000)
            }

        }


        store.sonoffIp = null
        try {
            store.sonoffIp = await Utils.findSonoffIpViaMdns()
            let confirmation = null
            if (configuredAutomatically || withUserInteraction) {
                confirmation = { confirm: true }
                console.log(`Sonoff device found automatically with IP: ${store.sonoffIp}`)
            } else {
                confirmation = await prompts({
                    name: "confirm",
                    type: "confirm",
                    initial: true,
                    message: `Sonoff device found automatically with IP: ${store.sonoffIp}. Is that OK? (if you want to set the IP manually, say no)`,
                })
            }
            if (!confirmation.confirm) {
                let manualIp = await prompts({
                    name: "ip",
                    type: "text",
                    initial: store.sonoffIp,
                    message: `What is the local IP of the Sonoff device? `,
                })
                store.sonoffIp = manualIp.ip
            }
        } catch (e) {
            console.log("\n❌ I could not find a sonoff device on this network. Are you sure it is connected?")
            let manualIp = await prompts({
                name: "ip",
                type: "text",
                message: `What is the local IP of the Sonoff device? `,
            })
            store.sonoffIp = manualIp.ip
        }

        await this.downloadLatestTasmota()
        await this.unlockOta(store.sonoffIp)
        await Utils.waitAsync(10000)
        await this.updateFirmware(`http://${store.localIp}:${port}/tasmota-lite.bin`)
    }

    async configureIteadAp() {
        if (!this.withUserInteraction) {
            store.lastSavedWifiCredentials = await prompts([{
                name: "ssid",
                type: "text",
                initial: store.lastConnectedWifiNetwork===null ? "":store.lastConnectedWifiNetwork.ssid,
                message: `What is your network wifi name?`,
            }, {
                name: "password",
                type: "password",
                message: `What is your network wifi password?`,
            }])
        } else {
            store.lastSavedWifiCredentials = store.lastConnectedWifiNetwork
        }

        console.log("Sending wifi configuration to the device")
        let result = await sonoffApi.setWifiConfiguration(store.lastSavedWifiCredentials.ssid, store.lastSavedWifiCredentials.password)
        if (result) {
            console.log("Device configured successfully")
            return true
        }
        throw "Something went wrong configuring AP on Sonoff Device"

    }

    async confirmIsReady() {
        console.log("My local IP Address is " + store.localIp)
        console.log("")
        console.log("Hello 👋. This program will upload tasmota-lite on your Sonoff device. ")
        console.log("First, turn on your Sonoff Device... ")
        console.log("The device must be running the iTEAD firmware version 3.6 or later. Sonoff Mini R2 should come with that version, but Sonoff Mini v1 may not. If you are not sure, pair the device using the eWelink app as usual, and upgrade the official firmware there.")
        let response = await prompts({
            name: "confirm",
            type: "confirm",
            message: "Sonoff is running software version 3.6 or later?",
            initial: true,
        })
        if (!response.confirm) {
            return false
        }
        console.log("\nGreat! Now, please enable REST API mode on the device: " + "\n" +
                "1) press the device button for 5 seconds" + "\n" +
                "2) wait about 4 seconds" + "\n" +
                "3) press for 5 more seconds.  The device will be blinking continuously." + "\n" +
                "4) Now, you should be able to connect to a wifi network called ITEAD-xxxxx.  Connect to Sonoff wifi access point (password is 12345678)" + "\n" +
                "5) Once connected to the device wifi network, visit http://10.7.7.1 and set your wifi credentials in the web form. Make sure that Sonoff and this computer are on the same network" + "\n")

        response = await prompts({
            name: "confirm",
            type: "confirm",
            initial: true,
            message: "Is the Sonoff device connected to your wifi in API REST mode?",
        })
        if (!response.confirm) {
            return false
        }

        const promptResponse = await prompts({
            type: "text",
            name: "localIP",
            message: "What is the IP of this computer?",
            initial: store.localIp,
        })
        store.localIp = promptResponse.localIP


        return true
    }

    async updateFirmware(downloadUrl) {
        console.log("Uploading tasmota...")
        console.log(store.sonoffIp, downloadUrl, store.binChecksumHash)
        let result = await sonoffApi.updateFirmware(store.sonoffIp, downloadUrl, store.binChecksumHash);
        if (result) {
            console.log("The device should be upgrading right now. Please wait about a minute until the device is rebooted")
            console.log("You should see Tasmota wifi network if everything went OK.")
            console.log("Please, do not close this window in the next minute or so, until you see Tasmota Wifi Network")
            console.log("")
            return true;
        }
        return false
    }


    async unlockOta() {
        console.log("")
        console.log("Connecting to the device API to check its status...")
        let info = await sonoffApi.info(store.sonoffIp)
        if (!info) {
            console.log("Are you sure the device is in DIY Mode and running firmware version 3.6?")
            console.log("Maybe: \n" +
                    "- Devices is not in the same network\n" +
                    "- Device is not running firmware version 3.6\n" +
                    "- Device is powered off\n" +
                    "- Devices is not on DIY Mode\n" +
                    "\n" +
                    "Try rebooting the device, and start again")
            process.exit(0)
        }


        if (info.data.otaUnlock) {
            console.log("Device already unlocked")
            return true;
        }

        console.log("Ota upgrade is not unlocked. Trying to unlock...  ")

        await Utils.waitAsync(2000)
        let result = await sonoffApi.unlock(store.sonoffIp)
        if (result) {
            console.log("🔓 Unlock Successful")
            return true;
        }
        return false
    }

    async downloadLatestTasmota() {
        let binFilePath = store.publicFolderPath + "/tasmota-lite.bin"
        if (fs.existsSync(binFilePath) && !this.alwaysUpdateBin) {
            console.log("⚡️ tasmota-lite.bin already exists. Skipping download");
            return true;
        }

        console.log("⚡️ Downloading latest tasmota-lite.bin file")



        let wasDownloaded = await Utils.download(binDownloadUrl, binFilePath)
        if (!wasDownloaded) {
            console.log(`❌ Could not download tasmota-lite.bin`)
            return false
        }
        store.binChecksumHash = await Utils.fileHash(binFilePath, "sha256")
        let statSync = fs.statSync(binFilePath)
        store.binSize = statSync.size
        let prettySize = prettyBytes(store.binSize)
        console.log(`👌 Downloaded ${prettySize} successfully at ${binFilePath}`)

        return true
    }

    async configureTasmotaAp(){
        let credentials = null
        if (store.lastSavedWifiCredentials) {
            credentials = store.lastSavedWifiCredentials
        } else {
            credentials = await prompts([{
                name: "ssid",
                type: "text",
                initial: store.lastConnectedWifiNetwork===null ? "": store.lastConnectedWifiNetwork.ssid,
                message: `What is your network wifi name?`,
            }, {
                name: "password",
                type: "password",
                message: `What is your network wifi password?`,
            }])
        }

        console.log("Sending wifi configuration to the device")
        await tasmotaApi.configureWifiCredentials(credentials.ssid, credentials.password);
        return true
    }


    async configureTasmota(auto) {
        await wifiManager.connectToSonoffWifi()
        if (auto) {
            let confirmation = await prompts({
                name: "confirm",
                type: "confirm",
                initial: true,
                message: `Do you want to configure Tasmota wifi connection?`,
            })

            if (!confirmation.confirm) {
                return false
            }
        }

        await Utils.waitAsync(3000);
        await this.configureTasmotaAp()
        await Utils.waitAsync(5000)
        if (store.sonoffIp !== null) {
            open('http://' + store.sonoffIp);
        }
        console.log('🚀 Process complete.')
        if (store.sonoffIp !== null) {
            console.log('Open tasmota web interface here: http://' + store.sonoffIp);
        }

        return true
    }

    async processDone() {
        console.log("Waiting 20 seconds for tasmota to start its wifi manager")
        try {
            await Utils.waitAsync(20000);
            await this.configureTasmota();
            process.exit()
        } catch (e) {
            console.log(e);
            return false
        }

    }


}

module.exports = new CliInstaller()
