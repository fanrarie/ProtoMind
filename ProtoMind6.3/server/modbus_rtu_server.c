#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <stdarg.h>
#include <modbus.h>
#include <time.h>
#include <unistd.h>

// 日志函数，带时间戳
void log_message(const char *level, const char *fmt, ...)
{
    va_list args;
    time_t now = time(NULL);
    char timestamp[32];
    strftime(timestamp, sizeof(timestamp), "%Y-%m-%d %H:%M:%S", localtime(&now));
    fprintf(stderr, "%s [%s] ", timestamp, level);
    va_start(args, fmt);
    vfprintf(stderr, fmt, args);
    va_end(args);
    fprintf(stderr, "\n");
    fflush(stderr);
}

// 打印报文内容
void log_packet(const char *prefix, const uint8_t *data, int len)
{
    fprintf(stderr, "%s: ", prefix);
    for (int i = 0; i < len; i++)
    {
        fprintf(stderr, "%02X ", data[i]);
    }
    fprintf(stderr, "\n");
    fflush(stderr);
}

// Modbus CRC16 计算
uint16_t modbus_crc16(const uint8_t *data, int length)
{
    uint16_t crc = 0xFFFF;
    for (int pos = 0; pos < length; pos++)
    {
        crc ^= (uint16_t)data[pos];
        for (int i = 8; i != 0; i--)
        {
            if ((crc & 0x0001) != 0)
            {
                crc >>= 1;
                crc ^= 0xA001;
            }
            else
            {
                crc >>= 1;
            }
        }
    }
    return crc;
}

int main()
{
    modbus_t *ctx = NULL;
    modbus_mapping_t *mb_mapping = NULL;
    uint8_t query[MODBUS_RTU_MAX_ADU_LENGTH];
    int rc;

    // 初始化日志
    log_message("INFO", "Starting Modbus RTU server on /dev/ttyS0, Slave ID: 1, Baudrate: 19200");

    // 创建 Modbus RTU 上下文
    ctx = modbus_new_rtu("/dev/ttyS0", 19200, 'N', 8, 1);
    if (ctx == NULL)
    {
        log_message("ERROR", "Unable to create Modbus RTU context: %s", modbus_strerror(errno));
        return 1;
    }

    // 设置从站 ID
    if (modbus_set_slave(ctx, 1) == -1)
    {
        log_message("ERROR", "Failed to set slave ID: %s", modbus_strerror(errno));
        modbus_free(ctx);
        return 1;
    }

    // 设置调试模式
    modbus_set_debug(ctx, TRUE);

    // 连接串口
    if (modbus_connect(ctx) == -1)
    {
        log_message("ERROR", "Connection failed: %s", modbus_strerror(errno));
        modbus_free(ctx);
        return 1;
    }

    // 分配寄存器和线圈
    mb_mapping = modbus_mapping_new(100, 100, 100, 100);
    if (mb_mapping == NULL)
    {
        log_message("ERROR", "Failed to allocate Modbus mapping: %s", modbus_strerror(errno));
        modbus_close(ctx);
        modbus_free(ctx);
        return 1;
    }

    // 初始化示例数据
    mb_mapping->tab_registers[0] = 1234; // 寄存器 0 的值
    mb_mapping->tab_bits[0] = 0;         // 线圈 0 的初始值

    log_message("INFO", "Modbus server initialized, waiting for queries...");

    while (1)
    {
        // 清空查询缓冲区
        memset(query, 0, MODBUS_RTU_MAX_ADU_LENGTH);

        // 接收报文
        rc = modbus_receive(ctx, query);
        if (rc > 0)
        {
            // 成功接收报文
            log_packet("Received query", query, rc);

            // 检查 CRC
            uint16_t received_crc = (query[rc - 2] | (query[rc - 1] << 8));
            uint16_t calculated_crc = modbus_crc16(query, rc - 2);
            if (received_crc != calculated_crc)
            {
                log_message("WARNING", "Invalid CRC: received 0x%04X, expected 0x%04X", received_crc, calculated_crc);
                // 继续循环，不退出
                continue;
            }

            // 处理报文
            int reply_rc = modbus_reply(ctx, query, rc, mb_mapping);
            if (reply_rc == -1)
            {
                log_message("ERROR", "Failed to reply: %s", modbus_strerror(errno));
                switch (errno)
                {
                case MODBUS_ENOBASE + MODBUS_EXCEPTION_ILLEGAL_FUNCTION:
                    log_message("WARNING", "Illegal function code: 0x%02X", query[1]);
                    break;
                case MODBUS_ENOBASE + MODBUS_EXCEPTION_ILLEGAL_DATA_ADDRESS:
                    log_message("WARNING", "Illegal data address");
                    break;
                case MODBUS_ENOBASE + MODBUS_EXCEPTION_ILLEGAL_DATA_VALUE:
                    log_message("WARNING", "Illegal data value");
                    break;
                default:
                    log_message("WARNING", "Unknown Modbus exception: %d", errno);
                    break;
                }
                // 发送异常响应后继续
                continue;
            }
            else
            {
                log_message("INFO", "Replied successfully, bytes sent: %d", reply_rc);
            }
        }
        else if (rc == -1)
        {
            // 接收错误
            log_message("ERROR", "Receive error: %s", modbus_strerror(errno));
            if (errno == EBADF || errno == ECONNRESET)
            {
                // 串口断开，尝试重新连接
                log_message("WARNING", "Serial port disconnected, attempting to reconnect...");
                modbus_close(ctx);
                if (modbus_connect(ctx) == -1)
                {
                    log_message("ERROR", "Reconnect failed: %s", modbus_strerror(errno));
                    sleep(1); // 等待 1 秒后重试
                    continue;
                }
                log_message("INFO", "Reconnected successfully");
            }
            // 其他错误，继续循环
            continue;
        }
        else
        {
            // rc == 0，通常是超时或无数据
            log_message("DEBUG", "No data received, continuing...");
            continue;
        }
    }

    // 清理资源（实际上不会执行到这里）
    log_message("INFO", "Shutting down server...");
    modbus_mapping_free(mb_mapping);
    modbus_close(ctx);
    modbus_free(ctx);
    return 0;
}