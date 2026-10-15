import type { Interface as ReadLine } from "node:readline";
import { out } from "../color";


type ConfirmFn = (prompt: string) => Promise<boolean>;
export let confirm: ConfirmFn = async () => false;   // 未注入时一律拒绝，命令不会再无人确认下执行

/**
 * 注入交互式确认逻辑（后续权限模型可在此替换）
*/
export function setConfirmFn(fn: ConfirmFn): void {
  confirm = fn;
}

function buildCliConfirm(rl: ReadLine): ConfirmFn {
  return (prompt) =>
      new Promise<boolean>((resolve) => {
        const onLine = (raw: string) => {
          rl.removeListener('line', onLine);
          const ans = raw.trim().toLowerCase();
          resolve(ans === 'y' || ans === 'yes');
        }

        rl.on('line', onLine);
        rl.resume();
        out('tool', `${prompt} [y/N]`);   // 确认提示染黄，一眼确认是危险操作
      });
}

/**
 * 用住 REPL 的 readline 接口安装 CLI 确认
 * */ 
export function installCliConfirm(rl: ReadLine): void {
  setConfirmFn(buildCliConfirm(rl));
}