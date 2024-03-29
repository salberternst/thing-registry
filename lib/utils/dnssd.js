'use strict'

const dnssd = require('dnssd')

function setupDnssd (port) {
  const mdnsAdvertisment = new dnssd.Advertisement(
    dnssd.tcp('thing-registry'),
    port
  )
  mdnsAdvertisment.start()
}

exports = module.exports = {
  setupDnssd
}
