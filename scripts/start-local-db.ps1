param([string]$MySqlBinary='C:\laragon\bin\mysql\mysql-8.0.30-winx64\bin\mysqld.exe')
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskData=[IO.Path]::GetFullPath((Join-Path $taskRoot '.local\mysql-data'))
if(!(Test-Path -LiteralPath $MySqlBinary)){throw 'Không tìm thấy mysqld. Truyền đường dẫn bằng -MySqlBinary.'}
if(!(Test-Path -LiteralPath (Join-Path $taskData 'auto.cnf'))){throw 'Database local chưa khởi tạo. Dùng MySQL của bạn và cấu hình DATABASE_URL.'}
$taskPort=Get-NetTCPConnection -LocalPort 3307 -State Listen -ErrorAction SilentlyContinue
if($taskPort){Write-Output 'Cổng 3307 đang lắng nghe. Không khởi động thêm server.';exit 0}
$taskArgs=@('--no-defaults',"--datadir=$taskData",'--port=3307','--bind-address=127.0.0.1','--mysqlx=0','--console')
Start-Process -FilePath $MySqlBinary -ArgumentList $taskArgs -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot '.local\mysql.stdout.log') -RedirectStandardError (Join-Path $taskRoot '.local\mysql.stderr.log')
Write-Output 'Đã khởi động MySQL local cổng 3307. Xem log trong .local nếu chưa kết nối được.'
