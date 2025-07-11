import { spawn } from "child_process"
import { WriteStream } from "fs"
import { system, filesystem } from "gluegun"

import {
  EXPO_ROUTER_SCREEN_TEMPLATE,
  EXPO_ROUTER_ROUTE_TEMPLATE,
  EXPO_ROUTER_DYNAMIC_ROUTE_TEMPLATE,
} from "../src/tools/react-native"
import { stripANSI } from "../src/tools/strip-ansi"

const IGNITE = "node " + filesystem.path(__dirname, "..", "bin", "ignite")
const shellOpts = { stdio: "inherit" }

jest.setTimeout(10 * 60 * 1000)

type RunOptions = {
  pre?: string // command to run before the command
  post?: string // command to run after the command
}

type SpawnOptions = RunOptions & {
  outputFileName: string
}

type CommandOutput = {
  output: string
  exitCode: number
}

function buildCommand(cmd: string, options: RunOptions) {
  return `${options.pre ? options.pre + " && " : ""}${cmd}${options.post ? " && " + options.post : ""}`
}

export async function run(cmd: string, options: RunOptions = {}): Promise<string> {
  const resultANSI = await system.run(buildCommand(cmd, options), shellOpts)
  return stripANSI(resultANSI)
}

export async function runError(cmd: string): Promise<string | any> {
  let resultANSI: string
  try {
    resultANSI = await system.run(`${IGNITE} ${cmd}`, shellOpts)
  } catch (e) {
    return e
  }
  return `No error thrown? Output: ${resultANSI}`
}

export async function runIgnite(cmd: string, options: RunOptions = {}): Promise<string> {
  return run(`${IGNITE} ${cmd}`, options)
}

async function deleteFileIfExists(file: string) {
  if (filesystem.exists(file)) {
    filesystem.remove(file)
  }
}

const artifactsDirectory = filesystem.path(__dirname, "artifacts")

async function setUpLogFile(filePath: string): Promise<WriteStream> {
  filesystem.dir(artifactsDirectory)
  const outputLog = filesystem.createWriteStream(filePath)

  await new Promise((resolve, reject) => {
    outputLog.on("open", resolve)
    outputLog.on("error", (err) => reject(err))
  })

  return outputLog
}

/**
 * Spawns a shell command and logs its output to the provided WriteStream.
 * Meant to log to a temporary file for later reading. This is an internal
 * function for use by `spawnAndLog`.
 *
 * @param cmd - The shell command to execute.
 * @param outputLog - The WriteStream where the command's output will be logged.
 * @returns A promise that resolves to the exit code of the command, or 99 if the exit code is null or undefined.
 *
 * @throws Will reject the promise if the subprocess fails to start.
 */
async function startSpawnAndLog(cmd: string, outputLog: WriteStream): Promise<number> {
  return new Promise((resolve, reject) => {
    const subprocess = spawn("sh", ["-c", cmd], { stdio: ["ignore", outputLog, outputLog] })
    subprocess.on("close", (code) => {
      console.log(`${cmd} exited with code ${code}`)
      resolve(code ?? 99)
    })
    subprocess.on("error", (err) => {
      console.log(`Failed to start subprocess: ${err}`)
      reject(err)
    })
  })
}

/**
 * Executes a command, logs its output to a file, and returns the command's exit code and output.
 * Uses `spawn`to run commands so that we can capture output in case of failure.
 * We can log the output to the test console by throwing it, or if that fails,
 * we can read the file for troubleshooting. Keep in mind that the output will
 * need ANSI characters stripped to be readable in that case.
 *
 * The error code should typically be `1` if the command fails, but is set to `99` by default in `runSpawnAndLog`.
 *
 * @param cmd - The command to execute.
 * @param options - Options for spawning the command, including the output file name.
 * @returns A promise that resolves to an object containing the exit code and the output of the command.
 * @throws Will throw an error if the output file cannot be read or if the command execution fails.
 */
export async function spawnAndLog(cmd: string, options: SpawnOptions): Promise<CommandOutput> {
  const fullCmd = buildCommand(cmd, options)
  const filePath = filesystem.path(artifactsDirectory, options.outputFileName)
  await deleteFileIfExists(filePath)

  const outputLog = await setUpLogFile(filePath)

  try {
    const exitCode = await startSpawnAndLog(fullCmd, outputLog)
    outputLog.end()

    const fileData = await filesystem.readAsync(filePath)
    if (fileData === undefined) {
      throw new Error("Failed to read output file")
    }
    return { exitCode, output: fileData }
  } catch (e) {
    outputLog.end()
    throw e
  }
}

export async function spawnAndLogIgnite(
  cmd: string,
  options: SpawnOptions,
): Promise<CommandOutput> {
  return spawnAndLog(`${IGNITE} ${cmd}`, options)
}

// Designed for printing command output to the Jest test console if it fails, by
// throwing the output.
export async function spawnIgniteAndPrintIfFail(
  cmd: string,
  options: SpawnOptions,
): Promise<string> {
  const { output, exitCode } = await spawnAndLogIgnite(cmd, options)
  if (exitCode !== 0) {
    // print entire command output to test console
    throw new Error(`Ignite new exited with code ${exitCode}: \n${stripANSI(output)}`)
  } else {
    return output
  }
}

function generateScreenTemplatePath(pathname: string): string {
  return filesystem.path(pathname, "ignite", "templates", "screen", "NAMEScreen.tsx.ejs")
}

function generateRouteTemplatePath(pathname: string): string {
  return filesystem.path(pathname, "ignite", "templates", "route", "NAME.tsx.ejs")
}

function generateDynamicRouteTemplatePath(pathname: string): string {
  return filesystem.path(pathname, "ignite", "templates", "dynamic-route", "NAME.tsx.ejs")
}

export function copyDefaultScreenGenerator(tempBoilerplatePath: string): void {
  const REACT_NAVIGATION_SCREEN_TEMPLATE = filesystem.read(
    filesystem.path(tempBoilerplatePath, "ignite", "templates", "screen", "NAMEScreen.tsx.ejs"),
  )

  const destination = generateScreenTemplatePath(tempBoilerplatePath)
  if (REACT_NAVIGATION_SCREEN_TEMPLATE) {
    filesystem.write(destination, REACT_NAVIGATION_SCREEN_TEMPLATE)
  }
}

export function copyExpoRouterGeneratorTemplates(tempBoilerplatePath: string): void {
  const screenDestination = generateScreenTemplatePath(tempBoilerplatePath)
  filesystem.write(screenDestination, EXPO_ROUTER_SCREEN_TEMPLATE)

  const routeDestination = generateRouteTemplatePath(tempBoilerplatePath)
  filesystem.write(routeDestination, EXPO_ROUTER_ROUTE_TEMPLATE)

  const dynamicRouteDestination = generateDynamicRouteTemplatePath(tempBoilerplatePath)
  filesystem.write(dynamicRouteDestination, EXPO_ROUTER_DYNAMIC_ROUTE_TEMPLATE)
}

export function removeScreenGenerator(tempBoilerplatePath: string): void {
  const destination = generateScreenTemplatePath(tempBoilerplatePath)
  filesystem.remove(destination)
}

export function removeExpoRouterGeneratorTemplates(tempBoilerplatePath: string): void {
  const screenDestination = generateScreenTemplatePath(tempBoilerplatePath)
  filesystem.remove(screenDestination)

  const routeDestination = generateRouteTemplatePath(tempBoilerplatePath)
  filesystem.remove(routeDestination)
}
