# DockerShift

`Dockershift` is a tool to help users build openshift configuration files starting from your docker compose.

## Get started

Convert [`docker-compose.yaml`](https://raw.githubusercontent.com/diogolmenezes/dockershift/master/templates/docker-compose-test.yml) into openshift config file with just one command:

```sh
$ npx dockershift ./docker-compose.yml --project project-name --prefix prefix --up
```

In case you want to not pass the path, the CLI gave you a interactive prompt to choose the right path (recursive search in your files at the project folder).

```sh
$ npx dockershift --project project-name --prefix prefix --up
```

To terminate the application, just run the CLI with the `--down` flag.

```sh
$ npx dockershift --project project-name --prefix --down
```

If you want to terminate all services, just run the command above with `--all` option.