a = [1,2,1,3,4,5,3]

temp = []
a.each do |itm|
	temp.push(itm) unless temp.include?itm
end
puts temp
