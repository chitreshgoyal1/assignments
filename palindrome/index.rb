def poly(s)
  h = Hash.new(0) 
  s.split('').each { | v | h.store(v, h[v]+1) } 
  count = 0
  h.values.each do |l|
   if l%2 != 0
     count = count+1 
   end
  end

  if count>1
   return false
  else
   return true
  end
end

puts poly("R1R1R1")
puts poly("CAPPCA")
