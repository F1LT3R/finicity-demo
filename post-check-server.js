const http = require('http')
const fs = require('fs')

const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
        console.log('-------------------------------------------')
        console.log('POST')

        if (req.param) {
            console.dir(req.param)
        }

        let body = ''

        req.on('data', data => {
            body += data
        })

        req.on('end', () => {
            console.log(`Body: ${body}`)

            res.writeHead(200, {
                'Content-Type': 'text/html'
            })

            return res.end(`The Post-Check-Server received: ${body}`)
        });
    }
})

const port = 3000
const host = '127.0.0.1'

server.listen(port, host)

console.log(`Listening at http://${host}:${port}`)
