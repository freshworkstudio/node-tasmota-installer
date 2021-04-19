const fs = require("fs")
const crypto = require("crypto")
const https = require("https")
const mdns = require("multicast-dns")()

class Utils {
    static fileHash(filename, algorithm = "md5") {
        return new Promise((resolve, reject) => {
            // Algorithm depends on availability of OpenSSL on platform
            // Another algorithms: 'sha1', 'md5', 'sha256', 'sha512' ...
            let shaSum = crypto.createHash(algorithm)
            try {
                let s = fs.ReadStream(filename)
                s.on("data", function (data) {
                    shaSum.update(data)
                })
                // making digest
                s.on("end", function () {
                    const hash = shaSum.digest("hex")
                    return resolve(hash)
                })
            } catch (error) {
                return reject("calc fail")
            }
        })
    }

    static download(url, dest) {
        return new Promise((resolve) => {
            let file = fs.createWriteStream(dest)
            https.get(url, (response) => {
                response.pipe(file)
                file.on("finish", () => {
                    file.close(() => {
                        resolve(true)
                    })
                })
            }).on("error", function (err) { // Handle errors
                fs.unlink(dest)
                resolve(false)
            })
        })

    }

    static async findSonoffIpViaMdns() {
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

    static async waitAsync (timeout) {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve()
            }, timeout)
        })
    }

}

module.exports = Utils
