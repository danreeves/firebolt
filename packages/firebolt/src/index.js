import { Command } from 'commander'

import { compile } from './compile'

const program = new Command()

program.name('firebolt').description('A description').version('1.0.0')

program.command('dev').action(() => {
  compile({ build: true, watch: true, serve: true })
})
program.command('build').action(() => {
  compile({ build: true, production: true })
})
program.command('start').action(() => {
  compile({ serve: true })
})

program.parse()
