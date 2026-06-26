let env = process.env.ECOEMS;

let lib;

if (env == "") {

	lib = "/home/eco_ems/eco_ems/lib/sys_wrapper";

}

else {

	lib = env + "/lib/sys_wrapper";

}

const corsair = require(lib);

const rdb = new corsair.RDB();

const db = new corsair.DB();

const control = new corsair.Control ();

const logger = require("../lib/cn_logger.js");

let flag = 0;																	//1-表示进程在函数内，0-表示函数结束

let last_status = 0;															//1-上次电网是有电，0-上次电网没电

let wait_soc_90_flag = true;

let first_enter_offgrid = true;

function sleep(delay) {

  return new Promise(resolve => setTimeout(resolve, delay));

}

// 互斥锁，确保同一时间只有1轮main执行

let mainLock = false;

module.exports.start = async function() {

  try {

    // 1. 初始化日志（同步操作）

    logger.init('xifei','debug');

    

    // 2. 异步初始化点位，必须加await，确保加载完成

    await init(); 

    logger.info("初始化完成，点位列表加载完毕");

    

    // 3. 定义「执行完一轮等1秒」的循环逻辑（替代setInterval）

    const runMainLoop = async () => {

      // 加锁保护：上一轮没完成，本轮不执行

      if (!mainLock) {

        mainLock = true; // 加锁

        try {

          await main(); // 执行main，等待完全完成

        } catch (error) {

          // 捕获异常，避免循环中断（工业程序核心要求）

          logger.error("main函数执行出错：", error.stack);

        } finally {

          mainLock = false; // 解锁（无论是否出错，都要解锁）

        }

      }

      // 等1秒后执行下一轮（确保两轮之间至少间隔1秒）

      setTimeout(runMainLoop, 1000);

    };

    

    // 4. 启动循环（先执行第一轮，再循环）

    runMainLoop();

    logger.info("程序启动成功，开始每秒执行控制策略");

    

  } catch (initError) {

    // 初始化失败，直接退出并记录错误

    logger.error("程序初始化失败：", initError.stack);

    process.exit(1); // 退出进程，避免空跑

  }

}

let pcs_on_off_list = [];														//pcs开关机点号

let pcs_status_list = [];														//pcs的状态点号					

let pcs_liwang_mode_list = [];													//pcs的离网模式控制点号

let pcs_liwang_on_off_list = [];												//PCS离网开关机状态点号 1是离网开机，0-是并网开机

let pcs_run_status_list = [];													//PCS运行状态

let pcs_flt_reset_list = [];													//PCS故障复位点号

async function init() 																//获取pcs的名称数组

{

	let  pcs_status,  pcs_liwang_on_off, pcs_on_off, pcs_liwang_mode, pcs_flt_reset ;//pcs的名称、并离网状态、开关机、并离网控制

	

	for(let i_=1; i_<6;i_++)

	{

		pcs_on_off = "PCcn0" + i_ + "pcs#0160Yc";

		pcs_status = "PCcn0" + i_ + "pcs#010Bh";

		pcs_liwang_mode = "PCcn0" + i_ +"pcs#0158Yc";

		pcs_liwang_on_off = "PCcn0" + i_ + "pcs#01152Bh";

		pcs_flt_reset  = "PCcn0" + i_ +"pcs#0161Yc";	

		

		pcs_on_off_list.push(pcs_on_off);

		pcs_status_list.push(pcs_status);

		pcs_liwang_on_off_list.push(pcs_liwang_on_off);

		pcs_liwang_mode_list.push(pcs_liwang_mode);

		pcs_flt_reset_list.push(pcs_flt_reset);

		

		logger.info("pcs_on_offpcs开关机控制:" + pcs_on_off + " pcs_status开关机状态:" + pcs_status + " pcs_liwang_mode并离网控制:" + pcs_liwang_mode + " pcs_liwang_on_off并离网状态:" + pcs_liwang_on_off + " pcs_flt_reset故障复归:" + pcs_flt_reset);

	}	

}

async function pcson()

{

	for(let i_=0; i_<5; i_++)

	{

		let pcs_status_value = rdb.getCol("prot", pcs_status_list[i_], "value"); 				 //获取pcs的开关机状态

		if(pcs_status_value == 1 )

		{

		let i=i_+1;

		logger.info("PCS0" + i + "已开机");

		}else

		{

		let ret = control.doSet(pcs_on_off_list[i_],1,false);									//PCS开机

		await sleep(500);

		let i=i_+1;

		logger.info("pcs0" + i + "开关机执行反馈为 " + ret  + pcs_status_value);

		

		let ret_reset = control.doSet(pcs_flt_reset_list[i_],32768,false);	

		await sleep(500);

		}

	}

}

async function pcsoff()

{

	for(let i_=0; i_<5; i_++)

	{

		let pcs_status_value = rdb.getCol("prot", pcs_status_list[i_], "value");  			//获取pcs的开关机状态

		if(pcs_status_value == 0 )

		{

		let i=i_+1;

		logger.info("PCS0" + i + "已关机");

		}else

		{

		let ret = control.doSet(pcs_on_off_list[i_],0,false);									//PCS关机

		await sleep(500);

		let i=i_+1;

		logger.info("pcs0" + i + "开关机执行反馈为 " + ret );

		

		let ret_reset = control.doSet(pcs_flt_reset_list[i_],32768,false);	

		await sleep(500);

		}

	}

}

async function qf1on()

{

	let chaifa_status_value = rdb.getCol("prot", "Kcn01qf1#018Bh", "value"); 				 //获取QF1的开关状态

	if(chaifa_status_value == 1 )

	{

	

	logger.info("QF1" + "已合闸状态");

	

	}else

	{

	

	let ret = control.doControl("break","Kcn01qf1h#01Kg",1,false);							//控制QF1合闸

	await sleep(500);

	

	logger.info("QF1执行反馈为 " + ret );

	}

}

async function qf1off()

{

	let chaifa_status_value = rdb.getCol("prot", "Kcn01qf1#018Bh", "value"); 				 //获取QF1的开关状态

	if(chaifa_status_value == 0 )

	{

	

	logger.info("QF1" + "已分闸状态");

	

	}else

	{

	

	let ret = control.doControl("break","Kcn01qf1f#01Kg",1,false);							//控制QF1分闸

	await sleep(500);

	logger.info("QF1执行反馈为 " + ret );

	}

}

async function pcsreset()

{

	for(let i_=0; i_<5; i_++)	// 修复：原来只循环2个，现在正确循环5个PCS

	{

		let ret = control.doSet(pcs_flt_reset_list[i_],32768,false);							//故障复位

		let i=i_+1;

		logger.info("pcs0" + i + "故障复归" );

	}

}

async function pcsbingwang()

{

	for(let i_=0; i_<5; i_++)

	{

		let pcs_liwang_mode_list_value = rdb.getCol("analog", pcs_liwang_mode_list[i_], "value");  			//获取pcs的并离网状态

		if(pcs_liwang_mode_list_value == 0 )

		{

		let i=i_+1;

		logger.info("PCS0" + i + "已并网状态");

		}else

		{

		let ret = control.doSet(pcs_liwang_mode_list[i_],0,false);									//PCS并网

		await sleep(500);

		let i=i_+1;

		logger.info("pcs0" + i + "并离网执行反馈为 " + ret );

		}

	}

}

async function pcsliwang()

{

	for(let i_=0; i_<5; i_++)

	{

		let pcs_liwang_mode_list_value = rdb.getCol("analog", pcs_liwang_mode_list[i_], "value");  			//获取pcs的并离网状态

		if(pcs_liwang_mode_list_value == 1 )

		{

		let i=i_+1;

		logger.info("PCS0" + i + "已离网状态");

		}else

		{

		let ret = control.doSet(pcs_liwang_mode_list[i_],1,false);									//PCS并离

		await sleep(500);

		let i=i_+1;

		logger.info("pcs0" + i + "并离网执行反馈为 " + ret );

		}

	}

}

async function chaifa01on()

{

	let chaifa_status01_value = rdb.getCol("break", "Kcn01cf01#01Kg", "value"); 				 //获取柴发01的开关机状态

	if(chaifa_status01_value == 1 )

	{

	

	logger.info("柴发01" + "已开机状态");

	

	}else

	{

	

	let ret = control.doControl("break","Kcn01cf01#01Kg",1,false);							//控制柴发01开机

	await sleep(5000);

	

	logger.info("柴发01开关机执行反馈为 " + ret );

	}

}

async function chaifa01off()

{

	let chaifa_status01_value = rdb.getCol("break", "Kcn01cf01#01Kg", "value"); 				 //获取柴发01的开关机状态

	if(chaifa_status01_value == 0 )

	{

	

	logger.info("柴发01" + "已关机状态");

	

	}else

	{

	

	let ret = control.doControl("break","Kcn01cf01#01Kg",0,false);							//控制柴发01关机

	await sleep(5000);

	logger.info("柴发01开关机执行反馈为 " + ret );

	

	}

}

async function chaifa02on()

{

	let chaifa_status02_value = rdb.getCol("break", "Kcn01cf02#01Kg", "value"); 				 //获取柴发02的开关机状态

	if(chaifa_status02_value == 1 )

	{

	

	logger.info("柴发02" + "已开机状态");

	

	}else

	{

	

	let ret = control.doControl("break","Kcn01cf02#01Kg",1,false);							//控制柴发02开机

	await sleep(5000);

	

	logger.info("柴发02开关机执行反馈为 " + ret );

	}

}

async function chaifa02off()

{

	let chaifa_status02_value = rdb.getCol("break", "Kcn01cf02#01Kg", "value"); 				 //获取柴发02的开关机状态

	if(chaifa_status02_value == 0 )

	{

	

	logger.info("柴发02" + "已关机状态");

	

	}else

	{

	

	let ret = control.doControl("break","Kcn01cf02#01Kg",0,false);							//控制柴发02关机

	await sleep(5000);

	logger.info("柴发02开关机执行反馈为 " + ret );

	

	}

}

async function pvon()

{

	let pv_status_value01 = rdb.getCol("analog","PVcn01pv#015Yc","value"); 				 //获取pv01的有功功率限制值

	

	if(pv_status_value01 != 0)

	{

	

	logger.info("pv01" + "有功功率限制值不为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#015Yc",121,false);										//控制pv01有功功率限制值为121

	await sleep(1000);

	logger.info("pv01有功功率限制值为 " + ret );

	

	}





	

	let pv_status_value02 = rdb.getCol("analog","PVcn01pv#025Yc","value"); 				 //获取pv02的有功功率限制值

	

	if(pv_status_value02 != 0)

	{

	

	logger.info("pv02" + "有功功率限制值不为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#025Yc",121,false);										//控制pv02有功功率限制值为121

	await sleep(1000);

	logger.info("pv02有功功率限制值为 " + ret );

	

	}



	

	let pv_status_value03 = rdb.getCol("analog","PVcn01pv#035Yc","value"); 				 //获取pv03的有功功率限制值

	

	if(pv_status_value03 != 0)

	{

	

	logger.info("pv03" + "有功功率限制值不为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#035Yc",121,false);										//控制pv03有功功率限制值为121

	await sleep(1000);

	logger.info("pv03有功功率限制值为 " + ret );

	

	}



	

	let pv_status_value04 = rdb.getCol("analog","PVcn01pv#045Yc","value"); 				 //获取pv04的有功功率限制值

	

	if(pv_status_value04 != 0)

	{

	

	logger.info("pv04" + "有功功率限制值不为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#045Yc",121,false);										//控制pv04有功功率限制值为121

	await sleep(1000);

	logger.info("pv04有功功率限制值为 " + ret );

	

	}



	let pv_status_value05 = rdb.getCol("analog","PVcn01pv#055Yc","value"); 				 //获取pv05的有功功率限制值

	

	if(pv_status_value05 != 0)

	{

	

	logger.info("pv05" + "有功功率限制值不为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#055Yc",121,false);										//控制pv05有功功率限制值为121

	await sleep(1000);

	logger.info("pv05有功功率限制值为 " + ret );

	

	}



	

	let pv_status_value06 = rdb.getCol("analog","PVcn01pv#065Yc","value"); 				 //获取pv06的有功功率限制值

	

	if(pv_status_value06 != 0)

	{

	

	logger.info("pv06" + "有功功率限制值不为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#065Yc",121,false);										//控制pv06有功功率限制值为121

	await sleep(1000);

	logger.info("pv06有功功率限制值为 " + ret );

	

	}



	

	let pv_status_value07 = rdb.getCol("analog","PVcn01pv#075Yc","value"); 				 //获取pv07的有功功率限制值

	

	if(pv_status_value07 != 0)

	{

	

	logger.info("pv07" + "有功功率限制值不为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#075Yc",121,false);										//控制pv07有功功率限制值为121

	await sleep(1000);

	logger.info("pv07有功功率限制值为 " + ret );

	

	}



	

	let pv_status_value08 = rdb.getCol("analog","PVcn01pv#085Yc","value"); 				 //获取pv08的有功功率限制值

	

	if(pv_status_value08 != 0)

	{

	

	logger.info("pv08" + "有功功率限制值不为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#085Yc",121,false);										//控制pv08有功功率限制值为121

	await sleep(1000);

	logger.info("pv08有功功率限制值为 " + ret );

	

	}



	

	let pv_status_value09 = rdb.getCol("analog","PVcn01pv#095Yc","value"); 				 //获取pv09的有功功率限制值

	

	if(pv_status_value09 != 0)

	{

	

	logger.info("pv09" + "有功功率限制值不为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#095Yc",121,false);										//控制pv09有功功率限制值为121

	await sleep(1000);

	logger.info("pv09有功功率限制值为 " + ret );

	

	}

	

}

async function pvoff()

{

	let pv_status_value01 = rdb.getCol("analog","PVcn01pv#015Yc","value"); 				 //获取pv01的有功功率限制值

	

	if(pv_status_value01 == 0)

	{

	

	logger.info("pv01" + "有功功率限制值为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#015Yc",0,false);										//控制pv01有功功率限制值为0

	await sleep(500);

	logger.info("pv01有功功率限制值为 " + ret );

	

	}



	let pv_status_value02 = rdb.getCol("analog","PVcn01pv#025Yc","value"); 				 //获取pv02的有功功率限制值

	

	if(pv_status_value02 == 0)

	{

	

	logger.info("pv02" + "有功功率限制值为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#025Yc",0,false);										//控制pv02有功功率限制值为0

	await sleep(500);

	logger.info("pv02有功功率限制值为 " + ret );

	

	}



	let pv_status_value03 = rdb.getCol("analog","PVcn01pv#035Yc","value"); 				 //获取pv03的有功功率限制值

	

	if(pv_status_value03 == 0)

	{

	

	logger.info("pv03" + "有功功率限制值为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#035Yc",0,false);										//控制pv03有功功率限制值为0

	await sleep(500);

	logger.info("pv03有功功率限制值为 " + ret );

	

	}



	let pv_status_value04 = rdb.getCol("analog","PVcn01pv#045Yc","value"); 				 //获取pv04的有功功率限制值

	

	if(pv_status_value04 == 0)

	{

	

	logger.info("pv04" + "有功功率限制值为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#045Yc",0,false);										//控制pv04有功功率限制值为0

	await sleep(500);

	logger.info("pv04有功功率限制值为 " + ret );

	

	}



	let pv_status_value05 = rdb.getCol("analog","PVcn01pv#055Yc","value"); 				 //获取pv05的有功功率限制值

	

	if(pv_status_value05 == 0)

	{

	

	logger.info("pv05" + "有功功率限制值为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#055Yc",0,false);										//控制pv05有功功率限制值为0

	await sleep(500);

	logger.info("pv05有功功率限制值为 " + ret );

	

	}



	

	let pv_status_value06 = rdb.getCol("analog","PVcn01pv#065Yc","value"); 				 //获取pv06的有功功率限制值

	

	if(pv_status_value06 == 0)

	{

	

	logger.info("pv06" + "有功功率限制值为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#065Yc",0,false);										//控制pv06有功功率限制值为0

	await sleep(500);

	logger.info("pv06有功功率限制值为 " + ret );

	

	}



	

	let pv_status_value07 = rdb.getCol("analog","PVcn01pv#075Yc","value"); 				 //获取pv07的有功功率限制值

	

	if(pv_status_value07 == 0)

	{

	

	logger.info("pv07" + "有功功率限制值为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#075Yc",0,false);										//控制pv07有功功率限制值为0

	await sleep(500);

	logger.info("pv07有功功率限制值为 " + ret );

	

	}



	

	let pv_status_value08 = rdb.getCol("analog","PVcn01pv#085Yc","value"); 				 //获取pv08的有功功率限制值

	

	if(pv_status_value08 == 0)

	{

	

	logger.info("pv08" + "有功功率限制值为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#085Yc",0,false);										//控制pv08有功功率限制值为0

	await sleep(500);

	logger.info("pv08有功功率限制值为 " + ret );

	

	}



	

	let pv_status_value09 = rdb.getCol("analog","PVcn01pv#095Yc","value"); 				 //获取pv09的有功功率限制值

	

	if(pv_status_value09 == 0)

	{

	

	logger.info("pv09" + "有功功率限制值为0");

	

	}else

	{

	

	let ret = control.doSet("PVcn01pv#095Yc",0,false);										//控制pv09有功功率限制值为0

	await sleep(500);

	logger.info("pv09有功功率限制值为 " + ret );

	

	}

}

async function pvmax()

{

	let pv_pset_value01 = rdb.getCol("analog","Ocn01pv#011Yc","value"); 				 //获取pv01有功设置值

	let pv_pset_value02 = rdb.getCol("analog","Ocn01pv#0211Yc","value"); 				 //获取pv02有功设置值

	let pv_pset_value03 = rdb.getCol("analog","Ocn01pv#0321Yc","value"); 				 //获取pv03有功设置值

	let pv_pset_value04 = rdb.getCol("analog","Ocn01pv#0431Yc","value"); 				 //获取pv04有功设置值

	let pv_pset_value05 = rdb.getCol("analog","Ocn01pv#0541Yc","value"); 				 //获取pv05有功设置值

	

	if(pv_pset_value01 == 80)

	{

	

	logger.info("pv01发电功率已设定为 80%");

	

	}else

	{

	

	let ret_pv1 = control.doSet("Ocn01pv#011Yc",80,false);					//光伏功率置为80%

	logger.info("pv01发电功率执行反馈为 " + ret_pv1 + "，设定值80%");

	

	}

	

	

	if(pv_pset_value02 == 80)

	{

	

	logger.info("pv02发电功率已设定为 80%");

	

	}else

	{

	

	let ret_pv2 = control.doSet("Ocn01pv#0211Yc", 80,false);					//光伏功率置为80%

	logger.info("pv02发电功率执行反馈为 " + ret_pv2 + "，设定值80%");

	}



	if(pv_pset_value03 == 80)

	{

	

	logger.info("pv03发电功率已设定为 80%");

	

	}else

	{

	

	let ret_pv3 = control.doSet("Ocn01pv#0321Yc", 80,false);					//光伏功率置为80%

	logger.info("pv03发电功率执行反馈为 " + ret_pv3 + "，设定值80%");

	}

	

	if(pv_pset_value04 == 80)

	{

	

	logger.info("pv04发电功率已设定为 80kW");

	

	}else

	{

	

	let ret_pv4 = control.doSet("Ocn01pv#0431Yc", 80,false);					//光伏功率置为80%

	logger.info("pv04发电功率执行反馈为 " + ret_pv4 + "，设定值80%");

	}

	

	if(pv_pset_value05 == 80)

	{

	

	logger.info("pv05发电功率已设定为 80kW");

	

	}else

	{

	

	let ret_pv5 = control.doSet("Ocn01pv#0541Yc", 80,false);					//光伏功率置为80%

	logger.info("pv05发电功率执行反馈为 " + ret_pv5 + "，设定值80%");

	}	

}

async function pvfollowing(fuzaibiao)

{

	

	

let ret_pv1 = control.doSet("Ocn01pv#011Yc", 0.2 * fuzaibiao, false);  // 光伏功率跟随负载

let ret_pv2 = control.doSet("Ocn01pv#0211Yc", 0.2 * fuzaibiao, false);

let ret_pv3 = control.doSet("Ocn01pv#0321Yc", 0.2 * fuzaibiao, false);

let ret_pv4 = control.doSet("Ocn01pv#0431Yc", 0.2 * fuzaibiao, false);

let ret_pv5 = control.doSet("Ocn01pv#0541Yc", 0.2 * fuzaibiao, false);



logger.info("光伏功率大于负载功率，设置光伏值为负载表功率的0.2倍。ret_pv1:" + ret_pv1 + ", ret_pv2:" + ret_pv2 + ", ret_pv3:" + ret_pv3 + ", ret_pv4:" + ret_pv4 + ", ret_pv5:" + ret_pv5);

	

}

async function main ()

{

	let soc_bess1 	= rdb.getCol("analog", "DCcn01bms#012Yc", "value");		//读取储能柜子1 SOC

	let soc_bess2 	= rdb.getCol("analog", "DCcn02bms#012Yc", "value");		//读取储能柜子2 SOC

	let soc_bess3 	= rdb.getCol("analog", "DCcn03bms#012Yc", "value");		//读取储能柜子3 SOC

	let soc_bess4 	= rdb.getCol("analog", "DCcn04bms#012Yc", "value");		//读取储能柜子4 SOC

	let soc_bess5 	= rdb.getCol("analog", "DCcn05bms#012Yc", "value");		//读取储能柜子5 SOC

	let soc 	 	= rdb.getCol("analog", "AB#0159Yc", "value");	  	//读取储能柜 SOC

	let chaifa_do2 	= rdb.getCol("break", "Kcn01cf02#01Kg", "value");	    	//柴发02 DO状态,1-开，0-关

	let chaifa_do1 	= rdb.getCol("break", "Kcn01cf01#01Kg", "value");	    	//柴发01 DO状态,1-开，0-关

	let	qf1 = rdb.getCol("prot","Kcn01qf1#018Bh","value");					//电网侧开关IO QF1

	let dianwang_v 	= rdb.getCol("analog","mecn01xlb#013Yc","value");		//需量表电压AB线电压

	let guangfubiao = rdb.getCol("analog","mecn01gfb#0112Yc","value");		//光伏表功率点

	let fuzaibiao 	= rdb.getCol("analog","amecn01fzb#0142Yc","value");		//负载表功率点

	let ems_p_set = guangfubiao - fuzaibiao + 20 ;							//系统充电设定值

	let ems_pv_all = guangfubiao - fuzaibiao;							//系统充电设定值	

	let sts_dt_stats = rdb.getCol("analog", "Ocn01sts#016Yc", "value");		//STS导通状态1并网  0离网

	let pcs_status_value01 = rdb.getCol("prot", "PCcn01pcs#010Bh", "value"); 				 //获取pcs的开关机状态

	let pcs_status_value02 = rdb.getCol("prot", "PCcn02pcs#010Bh", "value"); 				 //获取pcs的开关机状态

	let pcs_status_value03 = rdb.getCol("prot", "PCcn03pcs#010Bh", "value"); 				 //获取pcs的开关机状态	

	let pcs_status_value04 = rdb.getCol("prot", "PCcn04pcs#010Bh", "value"); 				 //获取pcs的开关机状态

	let pcs_status_value05 = rdb.getCol("prot", "PCcn05pcs#010Bh", "value"); 				 //获取pcs的开关机状态

	let sts_flaut1 = rdb.getCol("analog", "Ocn01sts#0138Yc", "value");		//读取STS故障

	let sts_flaut2 = rdb.getCol("analog", "Ocn01sts#0139Yc", "value");		//读取STS故障

	let sts_flaut3 = rdb.getCol("analog", "Ocn01sts#0140Yc", "value");		//读取STS故障

	let sts_flaut4 = rdb.getCol("analog", "Ocn01sts#0141Yc", "value");		//读取STS故障

	let sts_flaut5 = rdb.getCol("analog", "Ocn01sts#0142Yc", "value");		//读取STS故障

	let sts_tongdao = rdb.getCol("channel", "ccn01sts#01", "status");		//读取STS通道状态

	//STS通道或故障检测，异常时跳过本轮

	if (sts_tongdao != 2 || sts_flaut1 != 0 || sts_flaut2 != 0 || sts_flaut3 != 0 || sts_flaut4 != 0 || sts_flaut5 != 0) {

		return;

	}

	// ===== 并网策略 =====

	if(sts_dt_stats == 1 )

	{

		first_enter_offgrid = true;

		await pcson();

		if(soc_bess1 < 100  || soc_bess2 < 100  || soc_bess3 < 100  || soc_bess4 < 100 || soc_bess5 < 100)

		{	

			logger.info("运行并网策略");

			await pvon();


		}

		

	}

	// ===== 离网策略 =====

	if(sts_dt_stats == 0 )

	{	

	

		if (first_enter_offgrid)

		{

		  await pcson();

		  first_enter_offgrid = false;

		  logger.info("等待 2 秒确保PCS开机，此等待不影响正常离网放电；确保首次EMS开机是离网时，PCS是开机状态，能正常进入离网策略");

		  return;

		}

		

		

		

		// SOC>30：正常离网供电（PCS+PV）；SOC≤30启柴发；SOC≤10关PCS+PV

		// 注意：柴发启停和PCS关机逻辑移出PCS状态判断，避免SOC≤10关PCS后下一轮因PCS全关而跳过整块逻辑

		// pcson/pcsoff/pvon/pvoff内部已有状态检查，多次调用安全

		

		if(soc > 30) {

			// 只在PCS至少有一台开机时执行正常离网供电逻辑

			if(pcs_status_value01 == 1 || pcs_status_value02 == 1 || pcs_status_value03 == 1 || pcs_status_value04 == 1 || pcs_status_value05 == 1) {

				logger.info("运行离网策略");

				await pcson();

				await pvon();

				// 光伏充放电区间控制：任一单柜SOC≥92关光伏，平均SOC<87开光伏

				if(wait_soc_90_flag) {

					if(soc < 85) {

						wait_soc_90_flag = false;

						await pvon();

						logger.info("平均SOC < 87，光伏开机，PCS离网供电，当前平均SOC：" + soc + "   光伏功率" + guangfubiao);

					} else {

						await pvoff();

						logger.info("平均SOC ≥ 87，光伏关机（维持关机状态），PCS离网供电，当前平均SOC：" + soc);

					}

				} else {

					if(soc_bess1 >= 92 || soc_bess2 >= 92 || soc_bess3 >= 92 || soc_bess4 >= 92 || soc_bess5 >= 92) {

						await pvoff();

						wait_soc_90_flag = true;

						logger.info("任一单柜SOC≥92，光伏关机，PCS离网供电，当前各柜SOC：" + soc_bess1 + "/" + soc_bess2 + "/" + soc_bess3 + "/" + soc_bess4 + "/" + soc_bess5);

					} else {

						await pvon();

						logger.info("所有单柜SOC<92，光伏继续供电，PCS离网供电，当前各柜SOC：" + soc_bess1 + "/" + soc_bess2 + "/" + soc_bess3 + "/" + soc_bess4 + "/" + soc_bess5);

					}

				}

			}

		}

	

		if(soc <= 30) {

			logger.info("SOC小于设定值30，当前需开启柴发，当前SOC：" + soc);

		}

		
		if(soc <= 10) {

			await pvoff();

			await pcsoff();

			logger.info("SOC小于设定值10，PCS和光伏关机，当前SOC：" + soc);

		}

	

	}

}