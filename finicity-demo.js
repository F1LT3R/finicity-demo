const needle = require('needle')
const o2x = require('object-to-xml')
const jsonfile = require('jsonfile')
const Promise = require('bluebird')
const deepExtend = require('deep-extend')

const POSTCHECK = process.argv[2] === 'POSTCHECK'

const finicity_app_key = process.env.finicity_app_key
const finicity_partner_id = process.env.finicity_partner_id
const finicity_partner_secret = process.env.finicity_partner_secret

let host = 'http://127.0.0.1:3000'

if (!finicity_app_key) {
	console.error('Could not find your encironment variable "$finicity_app_key"')
	console.log('Have you sourced your "~/.finicity_keys" file?')
	process.exit(1)
}

if (!POSTCHECK) {
	host = 'https://api.finicity.com'
}

const endpoints = {
	authentication: '/aggregation/v2/partners/authentication',
	getInstitutions: '/aggregation/v1/institutions'
}

const stateFile = 'WARNING_BANK_ACCESS_KEYS.json'

const state = {
	current: {},

	load: () => new Promise((resolve, reject) => {
		jsonfile.readFile(stateFile, (err, res) => {
			if (err) {
				return reject(err)
			}

			state.current = res
			resolve(state.current)
		})
	}),

	save: () => new Promise((resolve, reject) => {
		console.log('save')
		jsonfile.writeFile(stateFile, state.current, (err, res) => {
			if (err) {
				return reject(err)
			}

			resolve(state.current)
		})
	}),

	merge: data => new Promise((resolve, reject) => {
		deepExtend(state.current, data)
		state.save()
			.then(currentState => {
				resolve(currentState)
			})
			.catch(err => {
				resject(err)
			})
	}),

	get: namespace => {},

	set: (namespace, data) => {
	}
}

const checkToken = state => new Promise((resolve, reject) => {
	if (Reflect.has(state, 'token') && typeof state.token === 'string') {
		return resolve(state.token)
	}

	resolve(authentication())
})

const authentication = () => new Promise((resolve, reject) => {
	const url = host + endpoints.authentication

	const params = null

	const body = {
		credentials: {
			partnerId: finicity_partner_id,
			partnerSecret: finicity_partner_secret
		}
	}

	const options = {
		headers: {
			'Finicity-App-Key': finicity_app_key,
			'Content-Type': 'application/xml',
			'Accept': 'application/json'
		}
	}

	// Finicity did not like my JSON requests for some reason, so I am sending
	// them as XML instead, for now.

	// Fincitiy does not like newlines in the XML. Security meassure?
	const bodyXml = o2x(body).replace(/\n/g, '')

	needle.post(url, bodyXml, options, (err, response) => {
		if (err) {
			return reject(err)
		}

		const data = JSON.parse(response.raw.toString())
		state.merge(data)
		resolve(state.current)
	})
})


state.load()
.then(checkToken)
.then(result => {
	console.log(result)
})
.catch(err => {
	console.error(err)
})