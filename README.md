# Airbitz Shitcoin Server for serving up all the coin are belong to us

`npm install`

## Install CouchDB

    brew install couchdb

## Launch CouchDB

    couchdb

## Build

    npm run build

## Launch shitcoin API server

    node lib/server.js

## Launch server using `forever-service`

    sudo forever-service install shitcoin -r [username] --script lib/server.js  --start
    
API calls

## GET

### Get Transaction

```
https://localhost:8080/api/transaction/[transaction_id]

{
  "_id": "fdc5615a6658e1b5349b5b62",
  "_rev": "1-d2907b1b6123d2bb18927580ab00eeb4",
  "networkFee": "10",
  "inputs": [
    {
      "address": "1oijaweoijg2aef__200",
      "amount": "50"
    },
    {
      "address": "2lkjaeoija209fa__150",
      "amount": "70"
    }
  ],
  "outputs": [
    {
      "address": "3029g2o4tiawehawlkwjf",
      "amount": "35"
    },
    {
      "address": "4029g2o4tiuhagwlkawgw",
      "amount": "75"
    }
  ]
}
```
### Get Address

Calling get address with an address ending in "__[amount]" will autofund the address with [amount] of coins.
ie. `GET https://localhost:8080/api/address/1o3iuhgiuhawet34t__250` will create an address with 250 coins.

Get address must be called on an address before it can receive funds

```
https://localhost:8080/api/address/[address]

{
  "_id": "3029g2o4tiawehawlkwjf",
  "_rev": "2-16fe358fa8178118a0fa46e2eab1e603",
  "balance": "35",
  "txids": [
    "223396f378f391f54ae81b51",
    "fdc5615a6658e1b5349b5b62"
  ]
}
```
## POST

### Spend

Spend from multiple addresses to multiple addresses.

Send (application/json) MIME type body with following format

```
https://localhost:8080/api/spend

{
        "inputs": [
                { "address": "1oijaweoijg2aef__200", "amount": "50" },
                { "address": "2lkjaeoija209fa__150", "amount": "70" }
        ],

        "outputs": [
                { "address": "3029g2o4tiawehawlkwjf", "amount": "35" },
                { "address": "4029g2o4tiuhagwlkawgw", "amount": "75" }
        ]
}
```
