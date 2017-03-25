# Finicity Demo

Connect to multiple bank accounts using the Finicity API

## Instructions

1. Clone this repo:

	```shell
	git clone git@github.com:F1LT3R/finicity-demo.git
	```

1. Cd into the repo directory:

	```shell
	cd finicity-demo
	```

1. Install the node packages:

	```shell
	npm install
	```

1. Export your finicity `client_id` and `secret` as environment variables:

	> Your Client ID & Secret can be found here: [https://developer.finicity.com/admin](https://developer.finicity.com/admin)

	```shell
	export finicity_partner_id_="<your partner id>"
	export finicity_partner_secret="<your partner secret>"
	export finicity_app_key="<your app key>"
	```

1. Copy the data file:

	```shell
	cp WARNING_BANK_ACCESS_KEYS.template.json WARNING_BANK_ACCESS_KEYS.json
	```

1. Run the demo:

	```shell
	node finicity-demo.js
	```