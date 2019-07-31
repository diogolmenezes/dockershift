const commander = require('commander');
const yamljs = require('yamljs');
const packageJson = require('./package.json');
const chalk = require('chalk');
const fs = require('fs');
const execa = require('execa');
const qoa = require('qoa');
const ora = require('ora');
const find = require('find');
const spinner = ora();

const ps = [
    {
        type: 'input',
        query: `${chalk.green('Type your username:')}`,
        handle: 'username'
    },
    {
        type: 'secure',
        query: `${chalk.green('Type your password:')}`,
        handle: 'password'
    }
];

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
        .option('--down', 'remove the project from openshift')
        .action(name => {
            dockerComposePath = name;
        })
        .option('--up')
        .option('--all', 'Use when you want to terminate all services all at once')
        .allowUnknownOption()
        .parse(process.argv);

    await checkOcLogin();

    if (typeof dockerComposePath === 'undefined') {
        const interactive = {
            type: 'interactive',
            query: chalk.green('Choose a docker compose file:'),
            handle: 'file',
            symbol: chalk.green('>'),
            menu: []
        };

        await find.file(/\W*(docker\-compose)\W*/, __dirname, async (files) => {
            interactive.menu = files;
            const compose = await qoa.prompt([interactive]);

            if (program.down) {
                await down(compose.file);
                process.exit(1);
            }
            
            createComposeFiles(compose.file);
        });
    } else {
        if (program.down) {
            await down(dockerComposePath);
            process.exit(1);
        }
        
        createComposeFiles(dockerComposePath);
    }
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
        const routes = await execute('oc', ['get', 'routes'], true);
        //console.log(yamljs.parse(routes.replace(new RegExp('\t', 'g'), ' '))['Requested Host'].split('\n')[0]);
    });
}

function createPod(service, compose) {
    const podTemplate = yamljs.load('./templates/pod.yml');
    const name = `${program.prefix.toLowerCase()}-${service}`;
    podTemplate.metadata.name = name;
    podTemplate.metadata.labels.app = name;
    podTemplate.metadata.labels.search = name;
    podTemplate.spec.selector.matchLabels.app = name;
    podTemplate.spec.template.metadata.labels.app = name;
    podTemplate.spec.template.metadata.labels.search = name;
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
            let ports = item.toString();
            if (ports.search(':') != -1) ports = ports.split(':')[1];

            return {
                containerPort: parseInt(ports),
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
    template.metadata.labels.search = name;
    template.spec.selector.app = name;

    if (compose.services[service].ports) {
        template.spec.ports = compose.services[service].ports.map(item => {
            const ports = item.toString().split(':');
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
        console.log(chalk.red('You are not logged into openshift, please enter credentials below:'));
        const props = await qoa.prompt(ps);
        await execute('oc', ['login', 'okdhmgmaster.rededor.corp:8443', `-u ${props.username}`, `-p ${props.password}`]);
    }
}

async function down(dockerComposePath) {
    const compose = yamljs.load(dockerComposePath);
    const services = Object.keys(compose.services);

    const interactive = {
        type: 'interactive',
        query: chalk.green('Choose a service to terminate:'),
        handle: 'service',
        symbol: chalk.green('>'),
        menu: services
    };

    if (!program.prefix) {
        console.log(chalk.red('Prefix flag is required.'))
        program.exit(1);
    }

    await execute('oc', ['project', program.project]);
    if (program.all) {
        startSpinner(`Deleting ${chalk.magenta('all')} services`);
        const deletePromises = services.map(async (svc) => {
            return execute('oc', ['delete', 'all', '-l', `search=${program.prefix}-${svc}`]);
        });
        await Promise.all(deletePromises);
    } else {
        const servicesList = await qoa.prompt([interactive]);
        startSpinner('Deleting project');
        await execute('oc', ['delete', 'all', '-l', `search=${program.prefix}-${servicesList.service}`]);
    }
    spinner.succeed();
}

async function up(service, podFile, serviceFile) {
    const name = `${program.prefix.toLowerCase()}-${service}`;
    await execute('oc', ['project', program.project]);
    startSpinner(`Creating ${chalk.yellow(service)} pods`);
    await execute('oc', ['create', '-f', podFile]);
    spinner.succeed();

    if (serviceFile) {
        startSpinner(`Creating ${chalk.yellow(service)} services`);
        await execute('oc', ['create', '-f', serviceFile]);
        spinner.succeed();
        await execute('oc', ['expose', `svc/${name}-service`, `--name=${name}-route`]);
    }
}

async function execute(command, args, output = false) {
    try {
        const { stdout } = await execa(command, args);

        if (output) {
            console.log(stdout);
        }

        return stdout;
    }
    catch (exception) {
        if (spinner.isSpinning) spinner.fail();
        console.log('\nERROR:', exception.message);
        process.exit(1);
    }
}

function startSpinner(text) {
    spinner.text = text;
    spinner.start();
}