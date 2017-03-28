let debug = false

const endpoints = {
	authentication: '/aggregation/v2/partners/authentication',
	getInstitutions: '/aggregation/v1/institutions',
	getLoginForm: '/aggregation/v1/institutions/{id}/loginForm',
	addCustomerTesting: '/aggregation/v1/customers/testing',
	addCustomer: '/aggregation/v1/customers/active',
	getCustomers: '/aggregation/v1/customers',
	addAllAccounts: '/aggregation/v1/customers/{customerId}/institutions/{institutionId}/accounts/addall',
	addAllAccountsMfa: '/aggregation/v1/customers/{customerId}/institutions/{institutionId}/accounts/addall/mfa',
}

const undocumentedErrorCode = 'UN-DOCUMENTED ERROR CODE!'

const errorcodes = {
	103: 'Invalid Credentials',
	106: undocumentedErrorCode,
	108: 'User Action Required',
	187: 'Missing or Incorrect MFA Answer'
}

let host = 'http://127.0.0.1:3000'

const https = require('https')
const o2x = require('object-to-xml')
const jsonfile = require('jsonfile')
const Promise = require('bluebird')
const deepExtend = require('deep-extend')
const commander = require('commander')
const chalk = require('chalk')
const html = require('html')
const Enquirer = require('enquirer')
const Question = require('prompt-question')
const PromptList = require('prompt-list')
const Table = require('cli-table')

const packageJson = require('./package.json')

jsonfile.spaces = 4

const POSTCHECK = process.argv[2] === 'POSTCHECK'

const finicityAppKey = process.env.finicity_app_key
const finicityPartnerId = process.env.finicity_partner_id
const finicityPartnerSecret = process.env.finicity_partner_secret

if (!finicityAppKey) {
	console.error('Could not find your encironment variable "$finicityAppKey"')
	throw new Error('Have you sourced your "~/.finicity_keys" file?')
}

if (!POSTCHECK) {
	host = 'api.finicity.com'
}

const stateFile = 'WARNING_BANK_ACCESS_KEYS.json'

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
		jsonfile.writeFile(stateFile, state.current, err => {
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
				reject(err)
			})
	})
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
	console.log()
	console.log(chalk.blue(`https://${host}${options.path}`))

	let responseBody = ''

	const defaultHeaders = {
		'Finicity-App-Key': finicityAppKey,
		'Content-Type': 'application/xml',
		Accept: 'application/json'
	}

	options.headers = deepExtend(defaultHeaders, options.headers)
	options.host = host

	if (debug) {
		console.log()
		console.log(chalk.green('OPTIONS'))
		console.log(chalk.green('-------'))
		console.log(chalk.green((JSON.stringify(options))))

		console.log()
		console.log(chalk.yellow('POST_DATA'))
		console.log(chalk.yellow('---------'))
		console.log(chalk.yellow(html.prettyPrint(postData)))
	}

	const request = https.request(options, response => {
		response.setEncoding('utf8')

		if (debug) {
			console.log()
			console.log('RESPONSE_HEADERS')
			console.log('----------------')
			console.dir(response.headers)

			console.log()
			console.log(chalk.yellow('STATUS_CODE'))
			console.log(chalk.yellow('-----------'))
			console.log(chalk.yellow(response.statusCode))
		}

		response.on('data', chunk => {
			responseBody += chunk.toString()
		})

		response.on('end', () => {
			if (debug) {
				console.log()
				console.log('RESPONSE_BODY')
				console.log('-------------')
				console.dir(responseBody)
			}

			try {
				const body = JSON.parse(responseBody)

				if (Reflect.has(body, 'code') && Reflect.has(body, 'message')) {
					console.log()
					console.log(chalk.red('ERROR_CODE'))
					console.log(chalk.red('-----------'))
					console.log(chalk.red(body.code))
					console.log(chalk.red(body.message))

					if (Reflect.has(errorcodes, body.code)) {
						console.log(chalk.red(errorcodes[body.code]))
					}
				}

				resolve({
					headers: response.headers,
					statusCode: response.statusCode,
					body
				})
			} catch (err) {
				console.log()
				console.log('RESPONSE_BODY_IN_ERROR(AS_HTML)')
				console.log('-------------------------------')
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

// Finicity did not like my JSON requests for some reason, so I am sending
// them as XML instead, for now.
const toSafeXml = obj => {
	// Fincitiy does not like newlines in the XML. Security meassure?
	return o2x(obj).replace(/\n/g, '')
}

const authentication = () => new Promise((resolve, reject) => {
	const options = {
		path: endpoints.authentication,
		method: 'POST',
		headers: {}
	}

	const body = {
		credentials: {
			partnerId: finicityPartnerId,
			partnerSecret: finicityPartnerSecret
		}
	}

	const postData = toSafeXml(body)

	request(options, postData)
	.then(response => {
		const dataToSave = {
			accessToken: {
				token: response.body.token,
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

const checkStateToken = currentState => new Promise(resolve => {
	if (!Reflect.has(currentState, 'accessToken')) {
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

const getInstitutions = (currentState, searchText, start, limit, cache) => new Promise((resolve, reject) => {
	const search = searchText.replace(/\s/g, '+')
	const query = `?search=${search}&start=${start}&limit=${limit}`

	const path = endpoints.getInstitutions + query

	const headers = {
		'Finicity-App-Token': currentState.accessToken.token
	}

	const options = {
		path,
		headers
	}

	const postData = null

	request(options, postData)
	.then(response => {
		if (response.body.institutions.length === 0) {
			console.log(`No insitutions found for search: "${searchText}".`)
			return resolve(currentState)
		}

		console.log(`Found ${chalk.yellow(response.body.institutions.length)} institutions for search: "${chalk.yellow(searchText)}".`)

		if (cache && cache.toUpperCase() === 'TRUE') {
			const dataToSave = {
				institutions: {}
			}

			response.body.institutions.forEach(institution => {
				dataToSave.institutions[institution.id] = institution
			})

			return state.merge(dataToSave)
			.then(currentState => {
				console.log(`Cached ${response.body.institutions.length} institutions.`)
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
		'Finicity-App-Token': currentState.accessToken.token
	}

	const options = {
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
							loginForm: response.body.loginForm,
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
		'Finicity-App-Token': currentState.accessToken.token
	}

	const options = {
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

	request(options, postData)
	.then(response => {
		if (!Reflect.has(response, 'id')) {
			console.warn(`Code ${response.body.code}: ${response.body.message}`)
			return
		}

		if (cache) {
			const dataToSave = {
				customers: {
					[username]: response.body
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
		'Finicity-App-Token': currentState.accessToken.token
	}

	const options = {
		path,
		headers,
		method: 'GET'
	}

	const postData = null

	request(options, postData)
	.then(response => {
		if (!Reflect.has(response.body, 'customers')) {
			console.warn(`Code ${response.body.code}: ${response.body.message}`)
			return
		}

		console.log(`Found ${response.body.found} customers.`)

		if (cache) {
			const dataToSave = {
				customers: {}
			}

			response.body.customers.forEach(customer => {
				dataToSave.customers[customer.username] = customer
			})

			return state.merge(dataToSave)
			.then(currentState => {
				console.log(`Cached new ${response.body.found} customers.`)
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
	.catch(err => {
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
	.catch(err => {
		return reject(err)
	})
})

const checkInsitutionHasLoginForm = institution => new Promise((resolve, reject) => {
	if (!Reflect.has(institution, 'login')) {
		const institutionName = chalk.yellow(institution.name)
		console.warn(`The institution "${institutionName}" has no login form.`)
		console.warn(`Fetching the login form for the institution "${institutionName}"...`)

		const cache = true
		return getLoginForm(state.current, institution.id, cache)
		.then(() => {
			resolve(institution)
		})
		.catch(reject)
	}

	if (loginFormExpired(institution.login.timestamp)) {
		console.log('Your login form is older than 1 day.')
		console.log('The login form is being re-fetched...')

		const cache = true
		return getLoginForm(state.current, institution.id, cache)
		.then(() => {
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
		const question = {
			message: `${institution.name} ${credential.description}:`,
			name: credential.id
		}

		if (credential.mask === 'true') {
			question.type = 'password'
		}

		questions.push(question)
	})

	const enquirer = new Enquirer()
	enquirer.register('list', require('prompt-list'))
	enquirer.register('password', require('prompt-password'))

	// NEVER CACHE THESE ANSWERS!
	enquirer.ask(questions)
	.then(answers => {
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

const getMfaAnswers = mfaQuestions => new Promise((resolve, reject) => {
	const cliQuestions = []

	const enquirer = new Enquirer()
	enquirer.register('list', require('prompt-list'))

	mfaQuestions.forEach(mfaQuestion => {
		const question = {
			message: mfaQuestion.text,
			name: mfaQuestion.text
		}

		if (Reflect.has(mfaQuestion, 'choices')) {
			const choiceList = []

			mfaQuestion.choices.forEach(mfaChoice => {
				choiceList.push(mfaChoice.choice)
			})

			question.type = 'list'
			question.choices = choiceList
		}

		cliQuestions.push(question)
	})

	enquirer.ask(cliQuestions)
	.then(answers => {
		resolve(answers)
	})
	.catch(reject)
})

const formatCurrency = (amount, type) => {
	const value = parseFloat(amount, 10)

	if (Number.isNaN(value)) {
		return amount || ''
	}

	let color
	const positive = value >= 0
	if (type === 'transaction') {
		color = positive ? 'blue' : 'green'
	} else if (type === 'balance') {
		color = positive ? 'green' : 'red'
	}

	const locale = value.toLocaleString('en-US', {style: 'currency', currency: 'USD'})

	return `${chalk[color](locale)}`
}

const displayAccounts = response => new Promise(resolve => {
	const accounts = response.body.accounts

	const table = new Table({
		style: {head: ['grey']},
		head: ['Name', 'Number', 'Balance', 'Type'],
		colWidths: [28, 16, 16, 12]
	})

	accounts.forEach(account => {
		table.push([
			account.name,
			account.number,
			formatCurrency(account.balance, 'balance'),
			account.type
		])
	})

	const output = table.toString()
	console.log(output)

	resolve(response)
})

const getAllAccountsMfa = props => new Promise((resolve, reject) => {
	const {customer, institution, mfaSession, mfaQuestions, credentialBody} = props

	const path = endpoints.addAllAccountsMfa
		.replace('{customerId}', customer.id)
		.replace('{institutionId}', institution.id)

	const headers = {
		'MFA-Session': mfaSession,
		'Finicity-App-Token': state.current.accessToken.token
	}

	const options = {path, headers, method: 'POST'}

	const mfaBody = {
		accounts: {
			mfaChallenges: {
				questions: {
					question: []
				}
			}
		}
	}

	let body

	if (credentialBody) {
		body = deepExtend(credentialBody, mfaBody)
	} else {
		body = mfaBody
	}

	getMfaAnswers(mfaQuestions)
	.then(answers => {
		Reflect.ownKeys(answers).forEach((mfaText, idx) => {
			const mfaQuestion = mfaQuestions[idx]

			const mfaAnswer = answers[mfaText]

			if (Reflect.has(mfaQuestion, 'choices')) {
				body.accounts.mfaChallenges.questions.question.push({
					text: mfaText,
					choices: mfaQuestion.choices,
					answer: mfaQuestions[idx].choices.find(mfaChoice => {
						return mfaChoice.choice === mfaAnswer
					}).value
				})
			} else {
				body.accounts.mfaChallenges.questions.question.push({
					text: mfaText,
					answer: mfaAnswer
				})
			}
		})

		const postData = toSafeXml(body)

		request(options, postData)
		.then(response => {
			if (Reflect.has(response.body, 'questions') &&
				Reflect.has(response.headers, 'mfa-session')
			) {
				const mfaSession = response.headers['mfa-session']
				const mfaQuestions = response.body.questions

				return getAllAccountsMfa({
					customer,
					institution,
					mfaSession,
					mfaQuestions,
					credentialBody
				})
				.then(resolve)
				.catch(reject)
			}

			resolve(response)
		})
		.catch(err => {
			return reject(err)
		})
	})
	.catch(reject)
})

const addAllAccounts = (customer, institution, credentials) => new Promise((resolve, reject) => {
	const path = endpoints.addAllAccounts
		.replace('{customerId}', customer.id)
		.replace('{institutionId}', institution.id)

	const headers = {
		'Finicity-App-Token': state.current.accessToken.token
	}

	const options = {path, headers, method: 'POST'}

	const body = {
		accounts: {
			credentials: {
				loginField: []
			}
		}
	}

	credentials.forEach(credential => {
		const {id, name, value} = credential
		body.accounts.credentials.loginField.push({id, name, value})
	})

	const postData = toSafeXml(body)

	request(options, postData)
	.then(response => {
		if (Reflect.has(response.body, 'questions') &&
			Reflect.has(response.headers, 'mfa-session')
		) {
			const mfaSession = response.headers['mfa-session']
			const mfaQuestions = response.body.questions

			return getAllAccountsMfa({
				customer,
				institution,
				mfaSession,
				mfaQuestions,
				credentialBody: body
			})
			.then(response => {
				const accounts = response.body.accounts
				console.log(chalk.green(`Found ${chalk.yellow(accounts.length)} accounts at ${chalk.yellow(institution.name)}`))
				resolve(response)
			})
			.catch(reject)
		}

		resolve(response)
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
		.then(response => {
			if (response.statusCode === 200) {
				console.dir(response.body.institutions)
			}
			resolve()
		})
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
		.catch(reject)
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

	default: () => new Promise((resolve, reject) => {
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
				addAllAccounts(customer, institution, answers)
				.then(response => {
					resolve(response)
				})
			})
			.catch(reject)
		}))
		.then(response => {
			if (response.statusCode === 200) {
				displayAccounts(response)
			}
			resolve()
		})
		.catch(reject)
	})
}

let commandGiven

commander
.version(packageJson.version)
.arguments('<command> [options...]')
.action((command, options) => {
	if (command.toUpperCase() === 'DEBUG') {
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
				if (result) {
					console.log(result)
				}
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
			if (result) {
				console.log(result)
			}
		})
		.catch(err => {
			console.error(err)
		})
}
