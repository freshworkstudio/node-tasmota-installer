const _ = require("lodash")
const express = require("express")
const fs = require("fs")
const https = require("https")
const crypto = require("crypto")
const mdns = require("multicast-dns")()
const axios = require("axios")
const ip = require("ip")
const prompts = require("prompts")
const prettyBytes = require('pretty-bytes');


let localIp = ip.address()

let tasmotaLiteHash = null

const app = express()

const PORT = 3123
const publicFolder = "./public"
const downloadUrl = "https://ota.tasmota.com/tasmota/release/tasmota-lite.bin"
let tasmotaBinSize = 500000;

const homedir = require('os').homedir();
let publicFolderPath = require('path').join(homedir, '.config/tasmota-installer/' + publicFolder);
fs.mkdirSync(publicFolderPath, {recursive: true});

app.use(function (req, res, next) {
    let range = req.header('Range');
    if (typeof range === 'undefined') {
        next();
        return;
    }
    let bytesSent = parseInt(req.header('Range').replace(/bytes=(([0-9])*)+-(([0-9])*)/g, '$3'));
    let percentage = ( Math.round((bytesSent/tasmotaBinSize)*100) );
    console.log(percentage + '% - ' + prettyBytes(bytesSent) + ' of ' + prettyBytes(tasmotaBinSize));

    if (percentage >= 95) {
        setTimeout(() => {
            console.log('🚀 Firmware uploaded successfully.')
            console.log('The device may be rebooting right now. You should see "tasmota-xxxxx" wifi network available to connect in a few moment.')
            process.exit(0)
        }, 5000);
    }
    next();
});

app.get("/", (req, res) => {
    res.send("Hello World!")
})
app.use(express.static(publicFolderPath))

app.listen(PORT, () => {
    console.log(`Server listening on port: ${PORT}`)

    run()
})
// lets query for an A record for 'brunhilde.local'

let run = async () => {
    let response = await confirmIsReady()
    if (!response) {
        process.exit(0)
        return
    }

    let sonoffIp = null
    try {
        sonoffIp = await findSonoffIpViaMdns()
        let confirmation = await prompts({ name: 'confirm', type: "confirm", initial: true, message: `Sonoff device found automatically with IP: ${sonoffIp}. Is that OK? (if you want to set the IP manually, say no)` })
        if (!confirmation.confirm) {
            let manualIp = await prompts({ name: 'ip', type: "text", initial: sonoffIp, message: `What is the local IP of the Sonoff device? `})
            sonoffIp = manualIp.ip;
        }
    } catch (e) {
        console.log('\n❌ I could not find a sonoff device on this network. Are you sure it is connected?')
        let manualIp = await prompts({ name: 'ip', type: "text", message: `What is the local IP of the Sonoff device? `})
        sonoffIp = manualIp.ip;
    }

    await downloadLatestTasmota()
    await unlockOta(sonoffIp)
    await waitAsync(10000)
    await updateFirmware(sonoffIp)
}

let confirmIsReady = async () => {
    console.log("My local IP Address is " + localIp)
    console.log("")
    console.log("Hello 👋. This program will upload tasmota-lite on your Sonoff device. ")
    console.log("First, turn on your Sonoff Device... ")
    console.log("The device must be running the iTEAD firmware version 3.6 or later. Sonoff Mini R2 should come with that version, but Sonoff Mini v1 may not. If you are not sure, pair the device using the eWelink app as usual, and upgrade the official firmware there.")
    let response = await prompts({
        name: 'confirm',
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
        name: 'confirm',
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
        initial: localIp,
    })
    localIp = promptResponse.localIP


    return true
}

let updateFirmware = async (sonoffIp) => {
    if (tasmotaLiteHash===null) {
        console.log("I do not know tasmota-lite file hash :(")
        return
    }

    let payload = {
        deviceid: "",
        data: {
            downloadUrl: `http://${localIp}:${PORT}/tasmota-lite.bin`,
            sha256sum: tasmotaLiteHash,
        },
    }

    console.log("Uploading tasmota...", payload)
    let url = `http://${sonoffIp}:8081/zeroconf/ota_flash`
    let response = await axios.post(url, payload)
    if (response.data.error===0) {
        console.log("The device should be upgrading right now. Please wait about a minute until the device is rebooted")
        console.log("You should see Tasmota wifi network if everything went OK.")
        console.log("Please, do not close this window in the next minute or so, until you see Tasmota Wifi Network")
        console.log('');
    } else {
        console.log("❌ Error uploading OTA upgrade", response.data)
    }
}

let unlockOta = async (sonoffIp) => {
    let url = `http://${sonoffIp}:8081/zeroconf/info`
    console.log("")
    console.log("Connecting to the device API to check its status...  (POST " + url + ")")
    let axiosInstance = axios.create({ timeout: 10000 })
    let response = null
    try {
        response = await axiosInstance.post(url, {
            deviceid: "",
            data: {},
        })
    } catch (e) {
        console.log(`❌ An error happened getting the information from the device through its API: ${e.message}`);
        console.log('Are you sure the device is in DIY Mode and running firmware version 3.6?');
        console.log('Maybe: \n' +
                '- Devices is not in the same network\n' +
                '- Device is not running firmware version 3.6\n' +
                '- Device is powered off\n' +
                '- Devices is not on DIY Mode\n' +
                '\n' +
                'Try rebooting the device, and start again');
        process.exit(0)
    }


    if (!response.data.data.otaUnlock) {
        console.log("Ota upgrade is not unlocked. Trying to unlock...  ")
        url = `http://${sonoffIp}:8081/zeroconf/ota_unlock`
        await waitAsync(2000)
        response = await axiosInstance.post(url, {
            deviceid: "",
            data: {},
        })

        if (response.data.error===0) {
            console.log("Unlock Successful")
        } else {
            console.log("Error unlocking ota upgrade", response.data)
        }
    } else {
        console.log("Device already unlocked")
    }
}

let waitAsync = async (timeout) => {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve()
        }, timeout)
    })
}

let findSonoffIpViaMdns = async () => {
    return new Promise((resolve, reject) => {
        console.log("Trying to find sonoff device on this network using mDNS for 10 seconds ")
        let mdnsHostname = "_ewelink._tcp.local"
        let timeout = null
        let mdnsTimeout = 5000
        let responseHandler = (response) => {
            const answer = response.answers.find(x => x.name===mdnsHostname)
            if (answer) {
                clearTimeout(timeout)
                let ipAnswer = response.answers.find(x => x.type==="A")
                finish()
                resolve(ipAnswer.data)
            }
        }

        mdns.on("response", responseHandler)

        mdns.query({
            questions: [{
                name: mdnsHostname,
                type: "PTR",
            }],
        })

        timeout = setTimeout(() => {
            finish()

            console.log("")
            console.log("Sonoff not found on this network, try pressing the device button for 5 seconds, wait 2 seconds, and press again for 5 seconds. Then connect to the device wifi network and open http://10.10.7.1 and enter your wifi credentials. The device and the computer running this script should be running on the same network. Make sure the device is running sonoff version 3.6 or later. If not sure, try pairing the device using ewelink app and update the firmware there and restart the process mentioned before. ")
            reject("No mDNS response in 5 seconds")
        }, mdnsTimeout)

        function finish() {
            mdns.removeListener("response", responseHandler)
            mdns.destroy()
        }
    })
}

let downloadLatestTasmota = async () => {
    console.log("⚡️ Downloading latest tasmota-lite.bin file")


    let tasmotaLiteFilePath = publicFolderPath + "/tasmota-lite.bin"
    await download(downloadUrl, tasmotaLiteFilePath)
    tasmotaLiteHash = await fileHash(tasmotaLiteFilePath, "sha256")
    let statSync = fs.statSync(tasmotaLiteFilePath)
    tasmotaBinSize = statSync.size;
    let prettySize = prettyBytes(tasmotaBinSize);
    console.log(`👌 Downloaded ${prettySize} successfully at ${tasmotaLiteFilePath}`)
}


function download(url, dest, cb) {
    return new Promise((resolve, reject) => {
        let file = fs.createWriteStream(dest)
        let request = https.get(url, (response) => {
            response.pipe(file)
            file.on("finish", () => {
                file.close(() => {
                    resolve(true)
                })  // close() is async, call cb after close completes.
            })
        }).on("error", function (err) { // Handle errors
            fs.unlink(dest) // Delete the file async. (But we don't check the result)
            reject()
        })
    })

}


function fileHash(filename, algorithm = "md5") {
    return new Promise((resolve, reject) => {
        // Algorithm depends on availability of OpenSSL on platform
        // Another algorithms: 'sha1', 'md5', 'sha256', 'sha512' ...
        let shasum = crypto.createHash(algorithm)
        try {
            let s = fs.ReadStream(filename)
            s.on("data", function (data) {
                shasum.update(data)
            })
            // making digest
            s.on("end", function () {
                const hash = shasum.digest("hex")
                return resolve(hash)
            })
        } catch (error) {
            return reject("calc fail")
        }
    })
}




