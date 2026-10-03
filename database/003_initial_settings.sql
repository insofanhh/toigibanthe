-- Du lieu cau hinh ban dau, dung duoc cho MySQL va TiDB.
-- Chay trong database cua app. Chay lai khong ghi de cau hinh da co.
INSERT IGNORE INTO meal_settings (id,name,cutoff_time,day_offset,sort_order) VALUES
 ('breakfast','Bữa sáng','11:00',0,0),
 ('lunch','Bữa trưa','15:00',0,1),
 ('dinner','Bữa tối','21:00',0,2),
 ('late','Quẩy đêm','01:00',1,3);

INSERT IGNORE INTO platform_settings (id,value) VALUES
 ('delivery',JSON_OBJECT('baseFee',15000,'perKm',0)),
 ('support',JSON_OBJECT('email','','phone',''));
