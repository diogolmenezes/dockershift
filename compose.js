const commander = require('commander');
const yamljs = require('yamljs');
const packageJson = require('./package.json');
const chalk = require('chalk');
const fs = require('fs');
const execa = require('execa');

init();

async function init() {
    let dockerComposePath;

    program = new commander.Command(packageJson.name)
        .version(packageJson.version)
        .arguments('<docker-compose-path>')
        .usage(`${chalk.green('<docker-compose-path>')} [options]`)
        .action(name => {
            dockerComposePath = name;
        })
        .option('--prefix <prefix>', 'project prefix')
        .option('--project <project>', 'project name')
        .option('--down <openshift-project-name>', 'remove the project from openshift')
        .option('--up', '')
        .allowUnknownOption()
        .parse(process.argv);

    if (program.down) {
        await down();
        process.exit(1);
    }

    if (typeof dockerComposePath === 'undefined') {
        console.error(chalk.red('Please specify the docker compose path'));
        console.log(
            `  ${chalk.cyan(program.name())} ${chalk.green('<dockerComposePath>')}`
        );
        console.log();
        console.log(
            `Run ${chalk.cyan(`${program.name()} --help`)} to see all options.`
        );
        process.exit(1);
    }

    createComposeFiles(dockerComposePath);
}

async function createComposeFiles(dockerComposePath) {
    const compose = yamljs.load(dockerComposePath);

    const promises = [];

    Object.keys(compose.services).map((service, index) => {
        const podFile = createPod(service, compose);
        const serviceFile = createService(service, compose);

        if (program.up) {
            promises.push(up(service, podFile, serviceFile));
        }
    });

    Promise.all(promises).then(async () => {
        await execute('oc', ['get', 'routes'], true);
    });
}

function createPod(service, compose) {
    const podTemplate = yamljs.load('./templates/pod.yml');
    const name = `${program.prefix.toLowerCase()}-${service}`;
    podTemplate.metadata.name = name;
    podTemplate.metadata.labels.app = name;
    podTemplate.spec.selector.matchLabels.app = name;
    podTemplate.spec.template.metadata.labels.app = name;
    podTemplate.spec.template.spec.containers[0].name = name
    podTemplate.spec.template.spec.containers[0].image = compose.services[service].image

    if (compose.services[service].environment) {
        podTemplate.spec.template.spec.containers[0].env = compose.services[service].environment.map(item => {
            items = item.split('=')
            return {
                name: items[0],
                value: items[1]
            }
        });
    } else {
        delete podTemplate.spec.template.spec.containers[0].env
    }

    if (compose.services[service].ports) {
        podTemplate.spec.template.spec.containers[0].ports = compose.services[service].ports.map(item => {
            const ports = item.split(':');
            return {
                containerPort: parseInt(ports[1]),
                protocol: 'TCP'
            }
        });
    }
    else {
        delete podTemplate.spec.template.spec.containers[0].ports
    }

    const file = `${name}.pod.yml`;

    fs.writeFileSync(file, yamljs.stringify(podTemplate, 8, 4));

    return file;
}

function createService(service, compose) {
    const template = yamljs.load('./templates/service.yml');
    const name = `${program.prefix.toLowerCase()}-${service}`;

    template.metadata.name = `${name}-service`;
    template.spec.selector.app = name;

    if (compose.services[service].ports) {
        template.spec.ports = compose.services[service].ports.map(item => {
            const ports = item.split(':');
            return {
                protocol: 'TCP',
                port: parseInt(ports[1]),
                targetPort: parseInt(ports[0])
            }
        });

        const file = `${name}.service.yml`;

        fs.writeFileSync(file, yamljs.stringify(template, 8, 4));

        return file;
    }
    else {
        delete template.spec.ports
    }

    return null;

}

async function checkOcLogin() {
    try {
        await execa('oc', ['status']);
    }
    catch {
        console.log('You must login at Openshift in cli before continue. (oc login url -u user -p pass)')
        process.exit(1);
    }
}

async function down() {
    await checkOcLogin();
    await execute('oc', ['project', program.down]);
    await execute('oc', ['delete', 'all', '--all']);
}

async function up(service, podFile, serviceFile) {
    const name = `${program.prefix.toLowerCase()}-${service}`;
    await checkOcLogin();
    await execute('oc', ['project', program.project]);
    await execute('oc', ['create', '-f', podFile]);

    if (serviceFile) {
        await execute('oc', ['create', '-f', serviceFile]);
        await execute('oc', ['expose', `svc/${name}-service`, `--name=${name}-route`]);
    }
}

async function execute(command, args, output = false) {
    try {
        const { stdout } = await execa(command, args);

        if (output) {
            console.log(stdout);
        }
    }
    catch (exception) {
        console.log('ERROR:', exception.message);
        process.exit(1);
    }
}