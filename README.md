# homebridge-jlr-incontrol

Jaguar Land Rover InControl plug in for Homebridge.

> Based on [https://github.com/nfarina/homebridge-tesla](homebridge-tesla).

Example config.json:

    {
      "accessories": [
        {
          "accessory": "InControl",
          "name": "I-PACE",
          "vin": "1AAAAA111AA111111",
          "username": "foo@bar.uk",
          "password": "foobar"
        }
      ]
    }

Exposes:

- Door Lock service;
- Vehicle pre-conditioning on/off switch;
- Charge status _(coming soon)_

If you use the example above, you would gain Siri commands like:

- _"Open the I-PACE"_ (unlock the vehicle)
- _"Turn on the I-PACE"_ (pre-condition the I-PACE)

## Multiple Vehicles

Have a garage full of Jaguar Land Rovers? You can easily add all of
them to HomeKit by creating a separate accessory for each one
distinguished by their unique VIN numbers:

    {
      "accessories": [
        {
          "accessory": "InControl",
          "name": "I-PACE",
          "vin": "1AAAAA111AA111111",
          "username": "foo@bar.uk",
          "password": "foobar"
        },
        {
          "accessory": "InControl",
          "name": "Range Rover",
          "vin": "2BBBBB222BB22222",
          "username": "foo@bar.uk",
          "password": "foobar"
        }
      ]
    }

If you use the example above, you would gain Siri commands like:

- _"Open the I-PACE"_ (unlock the **I-PACE**)
- _"Open the Range Rover"_ (unlock the **Range Rover**)
- _"Turn on the I-PACE"_ (pre-condition **on the I-PACE**)

## Development

You can run Rollup in watch mode to automatically transpile code as you write it:

```sh
  npm run dev
```
