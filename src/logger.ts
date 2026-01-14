const colors = {
  reset: "\x1b[0m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
};

function timestamp(): string {
  return new Date().toISOString().substring(11, 19);
}

export function info(message: string): void {
  console.log(
    `${colors.dim}[${timestamp()}]${colors.reset} ${colors.blue}INFO${colors.reset}  ${message}`
  );
}

export function success(message: string): void {
  console.log(
    `${colors.dim}[${timestamp()}]${colors.reset} ${colors.green}OK${colors.reset}    ${message}`
  );
}

export function warn(message: string): void {
  console.log(
    `${colors.dim}[${timestamp()}]${colors.reset} ${colors.yellow}WARN${colors.reset}  ${message}`
  );
}

export function error(message: string): void {
  console.log(
    `${colors.dim}[${timestamp()}]${colors.reset} ${colors.red}ERROR${colors.reset} ${message}`
  );
}
