const endpoints = {
	authentication: '/aggregation/v2/partners/authentication',
	getInstitutions: '/aggregation/v1/institutions',
	getLoginForm: '/aggregation/v1/institutions/{id}/loginForm',
	// addCustomer: '/aggregation/v1/customers/testing',
	addCustomer: '/aggregation/v1/customers/active',
	getCustomers: '/aggregation/v1/customers',
	addAllAccounts: '/aggregation/v1/customers/{customerId}/institutions/{institutionId}/accounts/addall',
}

const errorCodes = {
	aggregation: {
		103: 'Invalid Credentials'
	}
}

const institutionsToCache = [
	'TD Bank',
	'Vanguard',
	'USAA',
	'HealthEquity',
	'Capitol One'
]

let host = 'http://127.0.0.1:3000'

const https = require('https')
const o2x = require('object-to-xml')
const jsonfile = require('jsonfile')
const Promise = require('bluebird')
const deepExtend = require('deep-extend')
const queryString = require('query-string')
const commander = require('commander')
const chalk = require('chalk')
const html = require('html')
const packageJson = require('./package.json')
const Enquirer = require('enquirer')
const Question = require('prompt-question')
const PromptList = require('prompt-list')
const PromptPassword = require('prompt-password')

jsonfile.spaces = 4

let debug = false

const enquirer = new Enquirer()
enquirer.register('list', require('prompt-list'))
enquirer.register('password', require('prompt-password'))



const POSTCHECK = process.argv[2] === 'POSTCHECK'

const finicity_app_key = process.env.finicity_app_key
const finicity_partner_id = process.env.finicity_partner_id
const finicity_partner_secret = process.env.finicity_partner_secret

if (!finicity_app_key) {
	console.error('Could not find your encironment variable "$finicity_app_key"')
	console.log('Have you sourced your "~/.finicity_keys" file?')
	process.exit(1)
}

if (!POSTCHECK) {
	host = 'api.finicity.com'
}

const stateFile = 'WARNING_BANK_ACCESS_KEYS.json'

const has = (obj, ...lookups) => {
	let allTrue = true

	const step = (remainingSteps, pointer, type) => {
		const nextStep = remainingSteps.shift()
		const remainingStepCount = remainingSteps.length

		if (nextStep === undefined && typeof pointer === type) {
			return
		}

		if (remainingStepCount === 1 && !Reflect.has(pointer, nextStep)) {
			allTrue = false
			return
		}

		if (remainingStepCount === 0 && typeof pointer[nextStep] !== type) {
			allTrue = false
			return
		} else {

		}

		pointer = pointer[nextStep]

		if (remainingSteps.length >= 0) {
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

const oneDay = 1000 * 60 * 60 * 24
const loginFormExpired = cachedTimestamp => {
	const now = timeStamp()

	if (now - cachedTimestamp > oneDay) {
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

	if (debug) {
		console.log(chalk.green((JSON.stringify(options))))
	} else {
		console.log(chalk.green(options.host + options.path))
	}

	const request = https.request(options, response => {
		response.setEncoding('utf8');

		response.on('data', chunk => {
			responseBody += chunk.toString()
		})

		response.on('end', () => {
			try {
				const data = JSON.parse(responseBody)
				resolve(data)
			} catch (err) {
				console.log(chalk.red(html.prettyPrint(responseBody)))
				return reject(err)
			}
		})

		response.on('error', err => {
			reject(err)
		})

	})

	if (postData) {
		request.write(postData)
	}

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

const getInstitutions = (currentState, searchText, start, limit, cache) => new Promise((resolve, reject) => {
	const search = searchText.replace(/\s/g, '+')
	const query = `?search=${search}&start=${start}&limit=${limit}`

	const path = endpoints.getInstitutions + query

	const headers = {
		'Finicity-App-Token': currentState.accessToken.token,
	}

	var options = {
		path,
		headers
	}

	const postData = null

	request(options, postData)
	.then(response => {
		if (response.institutions.length === 0) {
			console.log(`No insitutions found for search: "${searchText}".`)
			return resolve(currentState)
		}

		console.log(`Found ${response.institutions.length} institutions for search: "${searchText}".`)

		if (cache.toUpperCase() === "TRUE") {
			const dataToSave = {
				institutions: {}
			}

			response.institutions.forEach(institution => {
				dataToSave.institutions[institution.id] = institution
			})

			return state.merge(dataToSave)
			.then(currentState => {
				console.log(`Cached ${response.institutions.length} institutions.`)
				resolve(currentState)
			})
			.catch(err => {
				reject(err)
			})
		}

		resolve(response)
	})
	.catch(err => {
		return reject(err)
	})
})

const getLoginForm = (currentState, id, cache) => new Promise((resolve, reject) => {
	const path = endpoints.getLoginForm.replace('{id}', id)

	const headers = {
		'Finicity-App-Token': currentState.accessToken.token,
	}

	var options = {
		path,
		headers
	}

	const postData = null

	request(options, postData)
	.then(response => {
		const institutionName = chalk.yellow(currentState.institutions[id].name)
		console.log(`Received login form for: ${institutionName}`)

		if (cache) {
			const dataToSave = {
				institutions: {
					[id]: {
						login: {
							loginForm: response.loginForm,
							timestamp: timeStamp()
						}
					}
				}
			}

			return state.merge(dataToSave)
			.then(currentState => {
				console.log(`Cached login form.`)
				resolve(currentState)
			})
			.catch(err => {
				reject(err)
			})
		}

		resolve(response)
	})
	.catch(err => {
		return reject(err)
	})
})

const addCustomer = (currentState, ...args) => new Promise((resolve, reject) => {
	const [
		username,
		firstName,
		lastName,
		cache
    ] = args

	const path = endpoints.addCustomer

	const headers = {
		'Finicity-App-Token': currentState.accessToken.token,
	}

	var options = {
		path,
		headers,
		method: 'POST'
	}

	const body = {
		customer: {
			username,
			firstName,
			lastName
		}
	}

	const postData = toSafeXml(body)
	// console.log(postData)

	request(options, postData)
	.then(response => {
		if (!Reflect.has(response, 'id')) {
			console.warn(`Code ${response.code}: ${response.message}`)
			return
		}

		if (cache) {
			const dataToSave = {
				customers: {
					[username]: response
				}
			}

			return state.merge(dataToSave)
			.then(currentState => {
				console.log(`Cached new user ${username}.`)
				resolve(currentState)
			})
			.catch(err => {
				reject(err)
			})
		}

		resolve(response)
	})
	.catch(err => {
		return reject(err)
	})
})

const getCustomers = (currentState, ...args) => new Promise((resolve, reject) => {
	const [cache] = args

	const path = endpoints.getCustomers

	const headers = {
		'Finicity-App-Token': currentState.accessToken.token,
	}

	var options = {
		path,
		headers,
		method: 'GET'
	}

	const postData = null

	request(options, postData)
	.then(response => {
		if (!Reflect.has(response, 'customers')) {
			console.warn(`Code ${response.code}: ${response.message}`)
			return
		}

		console.log(`Found ${response.found} customers.`)

		if (cache) {
			const dataToSave = {
				customers: {}
			}

			response.customers.forEach(customer => {
				dataToSave.customers[customer.username] = customer
			})

			return state.merge(dataToSave)
			.then(currentState => {
				console.log(`Cached new ${response.found} customers.`)
				resolve(currentState)
			})
			.catch(err => {
				reject(err)
			})
		}

		resolve(response)
	})
	.catch(err => {
		return reject(err)
	})
})

const selectCachedInstitution = currentState => new Promise((resolve, reject) => {
	const questionText = 'Select institution to access:'

	const institutionsList = []

	Reflect.ownKeys(currentState.institutions).forEach(institutionId => {
		institutionsList.push(currentState.institutions[institutionId].name)
	})

	const question = new Question('institution', questionText, {
		type: 'list',
		choices: institutionsList
	})

	const prompt = new PromptList(question)

	prompt.run()
	.then(answer => {
		Reflect.ownKeys(currentState.institutions).forEach(institutionId => {
			const institution = currentState.institutions[institutionId]

			if (institution.name === answer) {
				resolve(institution)
			}
		})
	})
	.catch(function(err) {
		return reject(err)
	})
})

const selectCachedCustomer = currentState => new Promise((resolve, reject) => {
	const questionText = 'Select customer:'

	const customers = currentState.customers
	const customerList = []

	Reflect.ownKeys(customers).forEach(username => {
		const customer = customers[username]
		const customerString = `${username} (${customer.id})`
		customerList.push(customerString)
	})

  const question = new Question('customer', questionText, {
    type: 'list',
    choices: customerList
  })

  const prompt = new PromptList(question)

	prompt.run()
	.then(answer => {
		Reflect.ownKeys(customers).forEach(username => {
			const customer = customers[username]
			const customerString = `${customer.username} (${customer.id})`

			if (answer === customerString) {
				resolve(customer)
			}
		})
	})
	.catch(function(err) {
		return reject(err)
	})
})

const checkInsitutionHasLoginForm = institution => new Promise((resolve, reject) => {
	if(!Reflect.has(institution, 'login')) {
		const institutionName = chalk.yellow(institution.name)
		console.warn(`The institution "${institutionName}" has no login form.`)
		console.warn(`Fetching the login form for the institution "${institutionName}"...`)

		const cache = true
		return getLoginForm(state.current, institution.id, cache)
		.then(currentState => {
			resolve(institution)
		})
		.catch(reject)
	}

	if (loginFormExpired(institution.login.timestamp)) {
		console.log('Your login form is older than 1 day.')
		console.log('The login form is being re-fetched...')

		const cache = true
		return getLoginForm(state.current, institution.id, cache)
		.then(currentState => {
			resolve(institution)
		})
		.catch(reject)
	}

	resolve(institution)
})

const getCredentials = institution => new Promise((resolve, reject) => {
	const questions = []
	const filledCredentials = []

	institution.login.loginForm.forEach(credential => {
		// console.log(credential)

		const question = {
			message: `${institution.name} ${credential.description}:`,
			name: credential.id
		}

		if (credential.mask === 'true') {
			question.type = 'password'
		}

		questions.push(question)
	})


	// NEVER CACHE THESE ANSWERS!
	enquirer.ask(questions)
	.then(answers => {
		// console.log(answers)

		Reflect.ownKeys(answers).forEach(credentialId => {
			const answer = answers[credentialId]

			institution.login.loginForm.forEach(loginCredential => {
				if (loginCredential.id === credentialId) {
					const credentialAnswer = deepExtend(loginCredential, {
						value: answer
					})

					filledCredentials.push(credentialAnswer)
				}
			})
		})

		resolve(filledCredentials)
	})
	.catch(reject)
})

const addAllAccounts = (customer, insitution, credentials) => new Promise((resolve, reject) => {
	// console.log(credentials)

	const path = endpoints.addAllAccounts
		.replace('{customerId}', customer.id)
		.replace('{institutionId}', insitution.id);

	console.log(path)

	const headers = {
		'Finicity-App-Token': state.current.accessToken.token,
	}

	var options = {
		path,
		headers,
		method: 'POST'
	}

	const body = {
		accounts: {
			credentials: {
				loginField: []
			}
		}
	}

	credentials.forEach(credential => {
		const {id, name, value} = credential
		console.log(id, name, value)

		body.accounts.credentials.loginField.push({id, name, value})
	})

	console.log(body)

	const postData = toSafeXml(body)
	console.dir(postData)
	process.exit()

	request(options, postData)
	.then(response => {
		console.log(response)
	})
	.catch(err => {
		return reject(err)
	})
})

const controlFlow = {
	getInstitutions: (searchText, start, limit, cache) => new Promise((resolve, reject) => {
		state.load()
		.then(checkStateToken)
		.then(currentState => {
			return getInstitutions(currentState, searchText, start, limit, cache)
		})
		.then(resolve)
		.catch(reject)
	}),

	listCachedInstitutions: () => new Promise((resolve, reject) => {
		state.load()
		.then(currentState => {
			const institutions = currentState.institutions
			Reflect.ownKeys(institutions)
			.forEach(key => {
				const institution = institutions[key]
				console.log(`${institution.id} - ${institution.name}`)
			})
		})
	}),

	getLoginForm: (...args) => new Promise((resolve, reject) => {
		const [id, cache] = args

		state.load()
		.then(checkStateToken)
		.then(currentState => {
			return getLoginForm(currentState, id, cache)
		})
		.then(resolve)
		.catch(reject)
	}),

	addCustomer: (...args) => new Promise((resolve, reject) => {
		state.load()
		.then(checkStateToken)
		.then(currentState => {
			return addCustomer(currentState, ...args)
		})
		.then(resolve)
		.catch(reject)
	}),

	getCustomers: (...args) => new Promise((resolve, reject) => {
		state.load()
		.then(checkStateToken)
		.then(currentState => {
			return getCustomers(currentState, ...args)
		})
		.then(resolve)
		.catch(reject)
	}),

	addAllAccounts: (...args) => new Promise((resolve, reject) => {
		state.load()
		.then(checkStateToken)
		.then(currentState => {
			return addAllAccounts(currentState, ...args)
		})
		.then(resolve)
		.catch(reject)
	}),

	default: (...args) => new Promise((resolve, reject) => {
		state.load()
		.then(checkStateToken)
		.then(currentState => new Promise((resolve, reject) => {
			selectCachedInstitution(currentState)
			.then(checkInsitutionHasLoginForm)
			.then(institution => {
				selectCachedCustomer(currentState)
				.then(customer => {
					resolve({institution, customer})
				})
				.catch(reject)
			})
			.catch(reject)
		}))
		.then(props => new Promise((resolve, reject) => {
			const {institution, customer} = props
			getCredentials(institution)
			.then(answers => {
				// console.log(answers)

				addAllAccounts(customer, institution, answers)
				.then(results => {
					console.log(results)
				})
			})
			.catch(reject)
		}))
		.then(result => {
			console.log('final result:', result)
		})
		// .then(resolve)
		.catch(reject)
	})
}

let commandGiven;

commander
.version(packageJson.version)
.arguments('<command> [options...]')
.action((command, options) => {
	if (command.toUpperCase() === "DEBUG") {
		debug = true
		command = options.shift()
	}

	if (debug) {
		console.log(command)
		console.dir(options)
	}

	if (Reflect.has(controlFlow, command)) {
		commandGiven = command
		return controlFlow[command](...options)
			.then(result => {
				console.log(result)
			})
			.catch(err => {
				console.error(err)
			})
	}
})
.parse(process.argv)

if (!commandGiven) {
	controlFlow.default()
		.then(result => {
			console.log(result)
		})
		.catch(err => {
			console.error(err)
		})
}
