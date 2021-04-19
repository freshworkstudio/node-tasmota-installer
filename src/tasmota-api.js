const axios = require("axios")

class TasmotaApi {
    async configureWifiCredentials(ssid, password) {
        await axios.get(" http://192.168.4.1/wi", {
            params: {
                s1: ssid,
                p1: password,
                s2: "",
                p2: "****",
                h: " %s-%04d",
                c: "",
                save: "",
            },
        })

        return true
    }
}

module.exports = new TasmotaApi()
