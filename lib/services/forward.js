'use strict'

const env = require('env-var')
const URL = require('url').URL
const HttpsProxyAgent = require('https-proxy-agent')
const HttpProxyAgent = require('http-proxy-agent')
const HttpProxy = require('http-proxy')
const CredentialsStorage = require('../utils/credentials_storage')
const createHttpCredentials = require('../utils/create_http_credentials')
const {
  InsufficientPermissions,
  InvalidAffordanceType,
  TargetNotFound,
  TargetNotAuthorized,
  ProtocolNotImplemented,
  AffordanceNotFound
} = require('../utils/http_errors')
const models = require('../models')

const ProxyTimeout = env
  .get('PROXY_TIMEOUT')
  .default(0)
  .asInt()
const IncomingTimeout = env
  .get('INCOMING_TIMEOUT')
  .default(0)
  .asInt()
const ProxyAddress = env.get('https_proxy').asString()
const httpsProxy = new HttpProxy({
  agent: ProxyAddress ? new HttpsProxyAgent(ProxyAddress) : undefined
})
const httpProxy = new HttpProxy({
  agent: ProxyAddress ? new HttpProxyAgent(ProxyAddress) : undefined
})

/**
 * Cleans up the header of the request.
 * @param {object} req - the request
 */
function cleanupHeaders (req) {
  delete req.headers['authorization']
  return req
}

/**
 * Checks if a protocol is secure
 * @param {string} protocol - Protocol to check
 */
function isSecureProtocol (protocol) {
  switch (protocol) {
    case 'https:':
    case 'wss:':
      return true
    default:
      return false
  }
}

/**
 * Builds the target url with query parameters
 */
function buildTargetUrl (href, queries = '') {
  const url = new URL(href)
  const encodedVariables = {
    ...Object.fromEntries(new URLSearchParams(url.search)),
    ...Object.fromEntries(new URLSearchParams(queries))
  }
  url.search = new URLSearchParams(encodedVariables).toString()
  return url.toString()
}

/**
 * Handles forwarding for http.
 */
async function handleHttp (req, res, next, { target, credentials, protocol }) {
  const proxy = isSecureProtocol(protocol) ? httpsProxy : httpProxy
  const result = createHttpCredentials(credentials, target)
  const targetUrl = buildTargetUrl(target.href, result.queries)
  return proxy.web(
    cleanupHeaders(req),
    res,
    {
      target: targetUrl,
      changeOrigin: true,
      ignorePath: true,
      ws: true,
      timeout: IncomingTimeout,
      proxyTimeout: ProxyTimeout,
      headers: result.headers
    },
    next
  )
}

/**
 * Handles forwarding for a websocket.
 */
async function handleWebsocket (
  req,
  socket,
  head,
  { target, credentials, protocol }
) {
  const proxy = isSecureProtocol(protocol) ? httpsProxy : httpProxy
  const result = createHttpCredentials(credentials, target)
  const targetUrl = buildTargetUrl(target.href, result.queries)
  return proxy.ws(req, socket, head, {
    target: targetUrl,
    changeOrigin: true,
    ignorePath: true,
    timeout: IncomingTimeout,
    proxyTimeout: ProxyTimeout,
    headers: result.headers
  })
}

/**
 * Validated for a correct affordance type
 */
function validateType (type) {
  switch (type) {
    case 'properties':
    case 'actions':
    case 'events':
      return true
  }
  return false
}

/**
 * Get the credentials for a specific target. If this target was created from a plugin
 * and the plugin supports authentication.
 */
async function getCredentials (id, target) {
  if (target.source !== undefined && target.source !== null) {
    const plugin = await models.plugin.findOne(target.source)
    if (plugin !== undefined && plugin.supportsAuthentication() === true) {
      return plugin.module.authenticate(target, {
        credentialsStorage: new CredentialsStorage(target.source, target.owner),
        readSettings: async () => {
          const { settings } = await models.pluginSettings.findOne(
            target.source,
            target.owner
          )
          return settings
        }
      })
    }
  }
  return models.credentials.get(id)
}

/**
 * Handles forwarding for exposed things. Currenlty only http forwarding is supported.
 */
async function forwardHttp (req, res, next) {
  const { id, name, index, type } = req.params
  if (validateType(type) === false) {
    throw new InvalidAffordanceType()
  }

  // check if resource exists
  const resourceId = await models.resource.find({
    name: `${id}/${type}/${name}`,
    exactName: true
  })
  if (resourceId.length === 0) {
    throw new AffordanceNotFound()
  }

  // get information of the target
  const target = await models.target.findOne({
    thingId: id,
    index,
    name,
    type
  })
  if (target === null) {
    throw new TargetNotFound()
  }

  // check if the user who is sending the request has
  // the authorization to do so
  const executable = await models.access.check({
    resource: resourceId[0],
    scopes: [req.method],
    token: req.auth.access_token.token
  })
  if (executable === undefined) {
    throw new InsufficientPermissions()
  }

  // check if the target is authorized to use the exposed mechanism
  if (target.authorized === false) {
    throw new TargetNotAuthorized()
  }

  // fetch all credentials for the current target
  const credentials = await getCredentials(id, target)

  // forward requests
  const url = new URL(target.href)
  switch (url.protocol) {
    case 'https:':
    case 'http:':
      return handleHttp(req, res, next, {
        credentials,
        target,
        protocol: url.protocol
      })
    case 'ws:':
    case 'wss:':
      return handleWebsocket(req, req.socket, req.head, {
        credentials,
        target,
        protocol: url.protocol
      })
    default:
      throw new ProtocolNotImplemented(url.protocol.slice(0, -1))
  }
}

exports = module.exports = forwardHttp
