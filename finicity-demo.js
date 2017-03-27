const institutionsToCache = [
	'TD Bank',
	'Vanguard',
	'USAA',
	'Health Equity',
	'Capitol One'
]

const https = require('https')

const o2x = require('object-to-xml')
const jsonfile = require('jsonfile')
const Promise = require('bluebird')
const deepExtend = require('deep-extend')
const queryString = require('query-string')

const POSTCHECK = process.argv[2] === 'POSTCHECK'

const finicity_app_key = process.env.finicity_app_key
const finicity_partner_id = process.env.finicity_partner_id
const finicity_partner_secret = process.env.finicity_partner_secret

let host = 'http://127.0.0.1:3000'
// let host = 'http://127.0.0.1:3000'

if (!finicity_app_key) {
	console.error('Could not find your encironment variable "$finicity_app_key"')
	console.log('Have you sourced your "~/.finicity_keys" file?')
	process.exit(1)
}

if (!POSTCHECK) {
	host = 'api.finicity.com'
	// host = 'https://api.finicity.com'
}

const endpoints = {
	authentication: '/aggregation/v2/partners/authentication',
	getInstitutions: '/aggregation/v1/institutions'
}

const stateFile = 'WARNING_BANK_ACCESS_KEYS.json'

const has = (obj, ...lookups) => {
	let allTrue = true

	const step = (remainingSteps, pointer, type) => {
		const nextStep = remainingSteps.shift()
		const remainingStepCount = remainingSteps.length

		if (remainingStepCount === 1 && !Reflect.has(pointer, nextStep)) {
			return allTrue = false
		}
		if (remainingStepCount === 0 && typeof pointer[nextStep] !== type) {
			return allTrue = false
		}

		pointer = pointer[nextStep]

		if (remainingSteps.length > 0) {
			step(remainingSteps, pointer, type)
		}
	}

	lookups.forEach(lookup => {
		const parts = lookup.split(':')
		const [type, chain, value] = parts
		const steps = chain.split('.')
		step(steps, obj, type)
	})

	return allTrue
}

const timeStamp = () => {
	return Number(new Date())
}

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

const nintyMinutes = 1000 * 60 * 90
const timestampExpired = cachedTimestamp => {
	const now = timeStamp()

	if (now - cachedTimestamp > nintyMinutes) {
		return true
	}

	return false
}

// Makes POST/GET HTTPS Request and returns JavaScript Object
const request = (options, postData) => new Promise((resolve, reject) => {
	let responseBody = ''

	const defaultHeaders = {
		'Finicity-App-Key': finicity_app_key,
		'Content-Type': 'application/xml',
		'Accept': 'application/json'
	}

	options.headers = deepExtend(defaultHeaders, options.headers)
	options.host = host

	const request = https.request(options, response => {
		response.setEncoding('utf8');

		response.on('data', chunk => {
			responseBody += chunk.toString()
		})

		response.on('end', () => {
			const data = JSON.parse(responseBody)
			resolve(data)
		})

		response.on('error', err => {
			reject(err)
		})

	})

	if (postData)
	request.write(postData)

	request.end()
})

const checkStateToken = currentState => new Promise((resolve, reject) => {
	if (!has(currentState, 'string:accessToken.token', 'number:accessToken.timestamp')) {
		console.log('No access token cached')
		resolve(authentication())
	}

	if (timestampExpired(currentState.accessToken.timestamp)) {
		console.log('Your Finicity access token has expired.')
		console.log('Reauthenticating...')
		resolve(authentication())
	}

	console.log('Existing access token is still valid.')
	return resolve(currentState)
})

// Finicity did not like my JSON requests for some reason, so I am sending
// them as XML instead, for now.
const toSafeXml = obj => {
	// Fincitiy does not like newlines in the XML. Security meassure?
	return o2x(obj).replace(/\n|\s/g, '')
}

const authentication = () => new Promise((resolve, reject) => {
	const options = {
		path: endpoints.authentication,
		method: 'POST',
		headers: {}
	}

	const body = {
		credentials: {
			partnerId: finicity_partner_id,
			partnerSecret: finicity_partner_secret
		}
	}

	const postData = toSafeXml(body)

	request(options, postData)
	.then(response => {
		const dataToSave = {
			accessToken: {
				token: response.token,
				timestamp: timeStamp()
			}
		}

		state.merge(dataToSave)
		.then(currentState => {
			resolve(currentState)
		})
		.catch(err => {
			reject(err)
		})
	})
	.catch(err => {
		return reject(err)
	})
})

const getInstitutions = (currentState, searchText, start, limit) => new Promise((resolve, reject) => {
	const query = queryString.stringify({
		search: searchText.replace(/\s/g, '+'),
		start,
		limit
	})

	const path = `${endpoints.getInstitutions}?${query}`

	const headers = {
		'Finicity-App-Token': currentState.accessToken.token,
	}

	var options = {
		path,
		headers
	}

	const postData = null

	request(options, postData).then(resolve).catch(reject)
	.then(response => {
		console.log(response)
	})
	.catch(err => {
		return reject(err)
	})
})

state.load()
.then(checkStateToken)
// .then(authentication)
.then(currentState => {
	// console.log(234, currentState)
	return getInstitutions(currentState, 'FinBank', 1, 10)
})
.then(result => {
	console.log(result)
})
.catch(err => {
	console.error(err)
})